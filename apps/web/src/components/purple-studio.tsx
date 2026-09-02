import {
  MAX_PATTERN_LENGTH,
  patternFilename,
  validateGeneratedPatternTitle,
  validatePatternCode,
} from '@purple/core/pattern'
import { describeValidationProblem } from '@purple/core/validation'
import { SHOWCASE_PATTERNS, type ShowcasePattern } from '@purple/core/recipes'
import type { SharedPattern } from '@purple/core/shared-pattern'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type {
  GeneratedPatternController,
  RevisionPhase,
} from './composer'
import { InternalLink, type NavigateInApp } from './internal-link'
import {
  clearByokChat,
  getByokKey,
  setByokKey,
} from '#/lib/byok-storage'
import {
  loadSessionPattern,
  removePattern,
  saveSessionPattern,
  sharedLibraryId,
  uniquePatternTitle,
  upsertPattern,
  usePatterns,
} from '#/lib/patterns'
import {
  agentLinkSocketUrl,
  agentMcpUrl,
  loadAgentLinkSettings,
  saveAgentLinkSettings,
  type AgentLinkSettings,
} from '#/lib/agent-link-storage'
import { hasUnappliedEditorChanges } from '@purple/ui/playback-flow'
import { PurpleMark } from '@purple/ui/purple-mark'
import { useAgentLink, type AgentLinkStatus } from '@purple/ui/use-agent-link'
import { SpectrumBars } from '@purple/ui/spectrum-bars'
import { usePlayback } from '@purple/ui/use-playback'
import type { PatternEditorProps } from '@purple/ui/pattern-editor'
import { WEB_AUDIO_OPTIONS, type WebPlayback } from '#/lib/playback'

const PatternEditor = lazy(async () => {
  const editor = await import('@purple/ui/pattern-editor')
  return { default: editor.PatternEditor }
})
const Composer = lazy(async () => {
  const composer = await import('./composer')
  return { default: composer.Composer }
})
const FeedbackDialog = lazy(async () => {
  const feedback = await import('./feedback-dialog')
  return { default: feedback.FeedbackDialog }
})
const ShareDialog = lazy(async () => {
  const share = await import('./share-dialog')
  return { default: share.ShareDialog }
})

function DeferredPatternEditor(props: PatternEditorProps) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // Let the shell and transport paint before requesting CodeMirror. Playback
    // does not depend on the editor chunk and remains usable in the meantime.
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const fallback = (
    <pre aria-label="Pattern editor loading" className="editor-loading">
      {props.code}
    </pre>
  )
  if (!ready) return fallback
  return (
    <Suspense fallback={fallback}>
      <PatternEditor {...props} />
    </Suspense>
  )
}

type Playback = WebPlayback

interface PurpleStudioProps {
  focusOnMount?: boolean
  navigate?: NavigateInApp
  sharedPattern?: SharedPattern
}

export function PurpleStudio(props: PurpleStudioProps) {
  const playback = usePlayback(WEB_AUDIO_OPTIONS)
  return <PurpleStudioView {...props} playback={playback} />
}

export function PersistentPurpleStudio(
  props: PurpleStudioProps & { playback: WebPlayback },
) {
  return <PurpleStudioView {...props} />
}

function PurpleStudioView({
  focusOnMount,
  navigate,
  playback,
  sharedPattern,
}: PurpleStudioProps & { playback: WebPlayback }) {
  const [byokKey, setByokKeyState] = useState<string | null>(() => getByokKey())
  const [agentLink, setAgentLinkState] = useState<AgentLinkSettings>(loadAgentLinkSettings)
  const [keyPanelOpen, setKeyPanelOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [libraryWasCleared, setLibraryWasCleared] = useState(false)
  const [patternStorageError, setPatternStorageError] = useState<string | null>(null)
  // The chat transcript survives reloads (loadByokChat), so the pattern it
  // produced must too - restoring one without the other desyncs the session.
  const [initialPattern] = useState(() => loadInitialPattern(sharedPattern))
  const [code, setCode] = useState(initialPattern.code)
  const [revisionPhase, setRevisionPhase] = useState<RevisionPhase>('idle')
  const [revisionStaged, setRevisionStaged] = useState(false)
  const [patternProvisional, setPatternProvisional] = useState(false)
  const [customTitle, setCustomTitle] = useState(initialPattern.customTitle)
  const [sourcePrompt, setSourcePrompt] = useState(initialPattern.sourcePrompt)
  const [shareId, setShareId] = useState<string | null>(initialPattern.shareId)
  const isPhoneWidth = usePhoneWidth()
  const savedPatterns = usePatterns()
  const mainRef = useRef<HTMLElement | null>(null)
  const libraryRef = useRef<HTMLElement | null>(null)
  const libraryButtonRef = useRef<HTMLButtonElement | null>(null)
  const generatedPatternControllerRef = useRef<GeneratedPatternController | null>(null)
  const codeRevisionRef = useRef(0)
  const titleRevisionRef = useRef(0)
  const registerGeneratedPatternController = useCallback(
    (controller: GeneratedPatternController | null) => {
      generatedPatternControllerRef.current = controller
    },
    [],
  )
  const getCodeRevision = useCallback(() => codeRevisionRef.current, [])
  const getTitleRevision = useCallback(() => titleRevisionRef.current, [])
  const patternLocked = revisionPhase !== 'idle'
  const patternActionLocked = patternLocked || patternProvisional
  const editorHasUnappliedChanges = hasUnappliedEditorChanges(
    playback.playbackState,
    code,
    playback.activeCode,
  )
  const commitGeneratedCode = useCallback((nextCode: string) => {
    setCode(nextCode)
    setShareId(null)
  }, [])
  const commitCode = useCallback((nextCode: string) => {
    codeRevisionRef.current++
    setRevisionStaged(false)
    generatedPatternControllerRef.current?.invalidate()
    commitGeneratedCode(nextCode)
  }, [commitGeneratedCode])
  const commitCustomTitle = useCallback((nextTitle: string | null) => {
    titleRevisionRef.current++
    setCustomTitle(nextTitle)
    setShareId(null)
  }, [])

  useEffect(() => {
    if (patternProvisional) return
    saveSessionPattern({ code, customTitle, sourcePrompt, shareId: shareId ?? undefined })
  }, [code, customTitle, patternProvisional, shareId, sourcePrompt])

  useEffect(() => {
    if (sharedPattern) clearByokChat()
  }, [sharedPattern?.id])

  /** False when the browser blocks localStorage, so the key cannot outlive this render. */
  const updateByokKey = (key: string | null): boolean => {
    setByokKey(key)
    // Removing the key also forgets the conversation it produced.
    if (!key) clearByokChat()
    const stored = getByokKey()
    setByokKeyState(stored)
    return key === null || stored === key.trim()
  }

  const title = customTitle ?? titleFromPrompt(sourcePrompt) ?? 'Untitled Pattern'
  const patternName = title.trim() || 'Untitled Pattern'

  const updateAgentLink = (next: AgentLinkSettings) => {
    saveAgentLinkSettings(next)
    setAgentLinkState(next)
  }

  // The bridge can send set_pattern and play back to back, faster than React
  // re-renders the handler closures; refs keep the served code current.
  const codeRef = useRef(code)
  codeRef.current = code
  const patternNameRef = useRef(patternName)
  patternNameRef.current = patternName
  const agentStatus = useAgentLink({
    enabled: agentLink.enabled,
    url: agentLinkSocketUrl(agentLink),
    handlers: {
      getSession: () => ({
        code: codeRef.current,
        title: patternNameRef.current,
        playbackState: playback.playbackState,
        playbackError: playback.error,
      }),
      setPattern: async (rawCode, rawTitle) => {
        const nextCode = validatePatternCode(rawCode)
        if (!nextCode) {
          throw new Error(
            `The pattern must be non-empty and at most ${MAX_PATTERN_LENGTH} characters.`,
          )
        }
        // Null means the engine has not initialized yet (no click so far);
        // the pattern lands unaudited and play-time errors stay the net.
        const problems = await playback.validatePattern(nextCode)
        if (problems !== null && problems.length > 0) {
          return {
            committed: false,
            problems: problems.map(describeValidationProblem),
          }
        }
        codeRef.current = nextCode
        commitCode(nextCode)
        if (rawTitle !== null) {
          const nextTitle = validateGeneratedPatternTitle(rawTitle)
          if (nextTitle) commitCustomTitle(nextTitle)
        }
        return { committed: true }
      },
      play: async () => {
        const result = await playback.transition(codeRef.current)
        if (result.ok) return { ok: true }
        if (result.kind === 'cancelled') {
          return { ok: false, error: 'Playback was interrupted by another action.' }
        }
        return { ok: false, error: result.error }
      },
      stop: () => playback.stop(),
    },
  })
  const libraryPattern = savedPatterns.find(
    (pattern) =>
      (shareId !== null && pattern.shareId === shareId) ||
      (pattern.title === patternName && pattern.code === code),
  )
  const currentPatternSaved = libraryPattern !== undefined

  const toggleSavedPattern = () => {
    if (!code.trim() || code.length > MAX_PATTERN_LENGTH) return
    const targetShareId = shareId
    let persisted = true
    if (libraryPattern) {
      persisted = removePattern(libraryPattern.id)
    } else {
      const now = Date.now()
      const savedTitle = uniquePatternTitle(patternName, savedPatterns)
      persisted = upsertPattern({
        id: targetShareId ? sharedLibraryId(targetShareId) : crypto.randomUUID(),
        title: savedTitle,
        code,
        prompt: sourcePrompt,
        shareId: targetShareId ?? undefined,
        createdAt: now,
        updatedAt: now,
      })
      if (!targetShareId && savedTitle !== patternName) {
        commitCustomTitle(savedTitle)
      }
    }
    if (!persisted) {
      setPatternStorageError(
        'This browser could not update the library. Allow site data and try again.',
      )
      return
    }
    setPatternStorageError(null)
    setLibraryWasCleared(false)
  }

  const acceptSharedPattern = (id: string, sharedTitle: string) => {
    const libraryUpdated = !libraryPattern || upsertPattern({
      ...libraryPattern,
      title: sharedTitle,
      shareId: id,
    })
    commitCustomTitle(sharedTitle)
    setShareId(id)
    if (!libraryUpdated) {
      setPatternStorageError(
        'The pattern was published, but this browser could not update its library copy.',
      )
      return
    }
    setPatternStorageError(null)
  }

  const exportPattern = () => {
    const url = URL.createObjectURL(new Blob([`${code.trim()}\n`], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = patternFilename(title)
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoking synchronously aborts the still-pending download outside Chromium.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const playCurrentPattern = () => {
    if (patternActionLocked || revisionStaged) return
    const generatedController = generatedPatternControllerRef.current
    if (generatedController) void generatedController.play(code)
    else void playback.play(code)
  }

  const togglePlayback = () => {
    if (
      playback.playbackState === 'playing' ||
      playback.playbackState === 'loading' ||
      playback.playbackState === 'transitioning'
    ) playback.stop()
    else playCurrentPattern()
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '.') {
        event.preventDefault()
        playback.stop()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [playback.stop])

  useEffect(() => {
    if (!libraryOpen) return
    // pointerdown, not click: the popover should close before whatever is
    // underneath reacts. The LIBRARY button is excluded so its own click
    // stays a toggle instead of close-then-reopen.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (libraryRef.current?.contains(target)) return
      if (libraryButtonRef.current?.contains(target)) return
      setLibraryOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setLibraryOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [libraryOpen])

  const audible =
    playback.playbackState === 'playing' || playback.playbackState === 'transitioning'
  const ledState =
    audible ? 'active' : playback.playbackState === 'loading' ? 'busy' : 'idle'

  useEffect(() => {
    if (focusOnMount) mainRef.current?.focus({ preventScroll: true })
  }, [focusOnMount])

  return (
    <main
      className="studio-shell"
      ref={mainRef}
      tabIndex={focusOnMount ? -1 : undefined}
    >
      <header className="topbar">
        <div className="brand">
          <PurpleMark className="brand-mark" />
          <span className="brand-name">PURPLE</span>
        </div>
        <div className="topbar-actions">
          {audible ? (
            <SpectrumBars className="eq-bars" getAnalyser={playback.getOutputAnalyser} />
          ) : null}
          <StatusLed state={ledState} />
          <InternalLink
            className="chrome patterns-link"
            href="/patterns"
            navigate={navigate}
          >
            PATTERNS
          </InternalLink>
          <a
            className="chrome source-link"
            href="https://github.com/ferdousbhai/purple"
            rel="noreferrer"
            target="_blank"
          >
            SOURCE
          </a>
          <a
            className="chrome source-link"
            href="https://opencollective.com/tidalcycles"
            rel="noreferrer"
            target="_blank"
            title="Purple runs on Strudel. Support its developers on Open Collective."
          >
            ♥ STRUDEL
          </a>
          <button
            className="chrome feedback-trigger"
            aria-haspopup="dialog"
            onClick={() => {
              setLibraryOpen(false)
              setFeedbackOpen(true)
            }}
          >
            FEEDBACK
          </button>
          <button
            ref={libraryButtonRef}
            className={`chrome ${libraryOpen ? 'open' : ''}`}
            aria-expanded={libraryOpen}
            aria-haspopup="true"
            onClick={() => setLibraryOpen((open) => !open)}
          >
            LIBRARY
          </button>
          {agentLink.enabled ? null : (
            <button
              className={`chrome ${keyPanelOpen ? 'open' : ''}`}
              onClick={() => setKeyPanelOpen((open) => !open)}
            >
              {byokKey ? 'KEY ✓' : 'KEY'}
            </button>
          )}
        </div>
      </header>

      {feedbackOpen ? (
        <Suspense fallback={null}>
          <FeedbackDialog onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      ) : null}

      {shareOpen ? (
        <Suspense fallback={null}>
          <ShareDialog
            code={code}
            existingId={shareId}
            navigate={navigate}
            title={patternName}
            onClose={() => setShareOpen(false)}
            onShared={acceptSharedPattern}
          />
        </Suspense>
      ) : null}

      {libraryOpen ? (
        <section className="library-popover" ref={libraryRef} aria-label="Pattern library">
          <header className="library-head">
            <span>LIBRARY</span>
            <span className="library-count">
              {savedPatterns.length === 1 ? '1 PATTERN' : `${savedPatterns.length} PATTERNS`}
            </span>
          </header>
          {savedPatterns.length === 0 ? (
            <p className="muted" role={libraryWasCleared ? 'status' : undefined}>
              {libraryWasCleared
                ? 'Library is clean. No saved patterns.'
                : 'Nothing saved yet. SAVE keeps a pattern in this browser.'}
            </p>
          ) : (
            [...savedPatterns]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((pattern) => (
                <div key={pattern.id} className="library-row">
                  <button
                    disabled={patternLocked}
                    onClick={() => {
                      commitCode(pattern.code)
                      commitCustomTitle(pattern.title)
                      setSourcePrompt(pattern.prompt)
                      setShareId(pattern.shareId ?? null)
                      setPatternStorageError(null)
                      setLibraryOpen(false)
                    }}
                  >
                    {pattern.title}
                  </button>
                  <button
                    className="delete"
                    aria-label={`Delete ${pattern.title}`}
                    onClick={() => {
                      if (!window.confirm(`Delete “${pattern.title}” from this browser?`)) return
                      if (!removePattern(pattern.id)) {
                        setPatternStorageError(
                          'This browser could not update the library. Allow site data and try again.',
                        )
                        return
                      }
                      setPatternStorageError(null)
                      if (savedPatterns.length === 1) setLibraryWasCleared(true)
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
          )}
        </section>
      ) : null}

      <div className="studio-grid">
        <section className="editor-pane">
          <div className="editor-bar">
            <input
              className="title-input"
              aria-label="Pattern title"
              name="pattern-title"
              value={title}
              disabled={patternActionLocked}
              onChange={(event) => commitCustomTitle(event.target.value)}
              maxLength={60}
            />
            {revisionPhase !== 'idle' || patternProvisional ? (
              <span className="editor-revision-status" role="status">
                {revisionPhase === 'revising'
                  ? 'REVISING…'
                  : revisionPhase === 'checking'
                    ? 'CHECKING…'
                    : 'FINISHING…'}
              </span>
            ) : null}
            <button
              className={`chrome ${currentPatternSaved ? 'saved' : ''}`}
              disabled={
                patternActionLocked || !code.trim() || code.length > MAX_PATTERN_LENGTH
              }
              onClick={toggleSavedPattern}
              title={
                currentPatternSaved
                  ? 'Remove from this browser’s library'
                  : 'Save to this browser’s library'
              }
            >
              <span aria-live="polite">{currentPatternSaved ? 'SAVED' : 'SAVE'}</span>
            </button>
            <button
              className="chrome"
              disabled={patternActionLocked || !code.trim() || code.length > MAX_PATTERN_LENGTH}
              onClick={() => setShareOpen(true)}
            >
              SHARE
            </button>
            <button
              className="chrome export"
              disabled={patternActionLocked}
              onClick={exportPattern}
            >
              EXPORT
            </button>
            {editorHasUnappliedChanges && !revisionStaged ? (
              <button
                className="chrome apply-changes"
                aria-label="Apply editor changes to playback (Ctrl+Enter)"
                title="Apply editor changes (Ctrl+Enter)"
                disabled={patternActionLocked}
                onClick={playCurrentPattern}
              >
                APPLY
              </button>
            ) : null}
            <button
              className={`transport ${audible || playback.playbackState === 'loading' ? 'stop' : 'start'}`}
              disabled={patternActionLocked && !audible}
              onClick={togglePlayback}
            >
              {transportLabel(playback.playbackState)}
            </button>
          </div>

          <div className="editor-surface">
            <DeferredPatternEditor
              code={code}
              playbackHighlightActive={
                playback.playbackState === 'playing' &&
                code === playback.activeCode
              }
              getActiveSourceRanges={playback.getActiveSourceRanges}
              onCodeChange={commitCode}
              readOnly={patternLocked}
              wrapLines={isPhoneWidth}
              // Strudel convention: Mod+Enter always (re-)evaluates, so a live
              // edit mid-playback picks up the new pattern instead of stopping.
              onEvaluate={playCurrentPattern}
            />
          </div>

          {playback.error ? <p className="error" role="alert">{playback.error}</p> : null}
          {patternStorageError ? (
            <p className="error" role="alert">{patternStorageError}</p>
          ) : null}
        </section>

        <aside className="session-pane">
          {agentLink.enabled ? (
            <AgentCard
              status={agentStatus}
              settings={agentLink}
              onSettingsChange={updateAgentLink}
            />
          ) : !byokKey || keyPanelOpen ? (
            <KeyCard
              byokKey={byokKey}
              onSave={(key) => {
                const stored = updateByokKey(key)
                if (stored) setKeyPanelOpen(false)
                return stored
              }}
              onClose={byokKey ? () => setKeyPanelOpen(false) : undefined}
              onUseAgent={() => {
                setKeyPanelOpen(false)
                updateAgentLink({ ...agentLink, enabled: true })
              }}
            />
          ) : (
            <Suspense fallback={<section className="composer" aria-busy="true" />}>
              <Composer
                byokKey={byokKey}
                code={code}
                customTitle={customTitle}
                shareId={shareId}
                sourcePrompt={sourcePrompt}
                playback={playback}
                restorePersistedChat={!sharedPattern}
                setCode={commitGeneratedCode}
                setRevisionPhase={setRevisionPhase}
                setRevisionStaged={setRevisionStaged}
                setPatternProvisional={setPatternProvisional}
                getCodeRevision={getCodeRevision}
                getTitleRevision={getTitleRevision}
                registerGeneratedPatternController={registerGeneratedPatternController}
                setCustomTitle={setCustomTitle}
                setShareId={setShareId}
                setSourcePrompt={setSourcePrompt}
              />
            </Suspense>
          )}
        </aside>
      </div>
    </main>
  )
}

function StatusLed({ state }: { state: 'active' | 'busy' | 'idle' }) {
  return (
    <div
      aria-label={`Status: ${state}`}
      title={`Status: ${state}`}
      role="status"
      className={`status-led ${state}`}
    />
  )
}

// Block wordmark for the first-run panel. Rows are fixed width so the
// letterforms stay aligned in any monospace fallback.
const PURPLE_WORDMARK = [
  '███  █  █ ███  ███  █    ████',
  '█  █ █  █ █  █ █  █ █    █',
  '███  █  █ ███  ███  █    ███',
  '█    █  █ █ █  █    █    █',
  '█     ██  █  █ █    ████ ████',
].join('\n')

function KeyCard(props: {
  byokKey: string | null
  onSave: (key: string | null) => boolean
  onClose?: () => void
  onUseAgent: () => void
}) {
  const [draft, setDraft] = useState('')
  const [storageBlocked, setStorageBlocked] = useState(false)
  const saveDraft = (nextDraft: string) => {
    const key = nextDraft.trim()
    if (!key) return
    setDraft(nextDraft)
    setStorageBlocked(!props.onSave(key))
  }
  return (
    <section className="key-card">
      <pre className="key-card-ascii" aria-hidden="true">{PURPLE_WORDMARK}</pre>
      <h2>YOUR GEMINI KEY</h2>
      <p>
        Purple has no accounts. Your Gemini key, chat, and library stay in this browser.
        Patterns you choose to share publish their title and code for anyone to play.
      </p>
      <p>
        Get a free key from{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          Google AI Studio
        </a>{' '}
        and paste it below. Editing and playback work without one.
      </p>
      {storageBlocked ? (
        <p className="error" role="alert">
          This browser is blocking local storage, so the key cannot be kept.
          Allow site data (or leave private browsing) and try again.
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          saveDraft(draft)
        }}
      >
        <input
          type="password"
          aria-label="Gemini API key"
          name="gemini-api-key"
          placeholder={props.byokKey ? 'A key is saved in this browser' : 'AIza…'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const pastedKey = event.clipboardData.getData('text')
            if (!pastedKey.trim()) return
            event.preventDefault()
            saveDraft(pastedKey)
          }}
          autoComplete="off"
        />
        <div className="key-card-actions">
          <button className="primary" disabled={!draft.trim()}>SAVE</button>
          {props.byokKey ? (
            <button type="button" className="chrome" onClick={() => props.onSave(null)}>
              REMOVE KEY
            </button>
          ) : null}
          {props.onClose ? (
            <button type="button" className="chrome" onClick={props.onClose}>CLOSE</button>
          ) : null}
        </div>
      </form>
      <div className="provider-alt">
        <p>
          No key? Purple can also be played by your own AI agent, like Claude
          Code, over MCP. Nothing to install.
        </p>
        <button type="button" className="chrome" onClick={props.onUseAgent}>
          CONNECT LOCAL AGENT
        </button>
      </div>
    </section>
  )
}

function AgentCard(props: {
  status: AgentLinkStatus
  settings: AgentLinkSettings
  onSettingsChange: (settings: AgentLinkSettings) => void
}) {
  const [copied, setCopied] = useState(false)
  const connected = props.status === 'connected'
  const command = `claude mcp add --transport http purple ${agentMcpUrl(props.settings.code)}`
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Clipboard blocked; the command stays selectable text.
    }
  }
  return (
    <section className="key-card agent-card">
      <pre className="key-card-ascii" aria-hidden="true">{PURPLE_WORDMARK}</pre>
      <h2>LOCAL AGENT</h2>
      <p role="status" className={connected ? 'agent-status connected' : 'agent-status'}>
        {connected
          ? 'AGENT LINKED. Ask your agent to make music.'
          : 'WAITING FOR YOUR AGENT. Register it below, then talk to it.'}
      </p>
      <p>
        Nothing to install: register this tab with your agent and it can read
        the session, set patterns, and start or stop playback. For Claude
        Code, run this once:
      </p>
      <pre className="agent-command">{command}</pre>
      <div className="key-card-actions">
        <button type="button" className="primary" onClick={copyCommand}>
          <span aria-live="polite">{copied ? 'COPIED' : 'COPY COMMAND'}</span>
        </button>
        <button
          type="button"
          className="chrome"
          onClick={() =>
            props.onSettingsChange({ ...props.settings, enabled: false })
          }
        >
          USE GEMINI KEY INSTEAD
        </button>
      </div>
      <p>
        Any MCP client that can reach remote servers works the same way; the
        link in the command is this browser&rsquo;s private pairing address, so
        share it with your own agent only. Browsers allow sound only after a
        click, so press PLAY once if the agent reports blocked audio.
      </p>
    </section>
  )
}

/** Mirrors the stylesheet's phone tier, where the editor wraps long lines. */
function usePhoneWidth(): boolean {
  const [isPhone, setIsPhone] = useState(
    () => window.matchMedia('(max-width: 560px)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(max-width: 560px)')
    const update = () => setIsPhone(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return isPhone
}

function titleFromPrompt(prompt: string | undefined): string | null {
  const text = prompt?.trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.length <= 48 ? text : `${text.slice(0, 47).trimEnd()}…`
}

function loadInitialPattern(sharedPattern?: SharedPattern) {
  if (sharedPattern) {
    return {
      code: sharedPattern.code,
      customTitle: sharedPattern.title,
      sourcePrompt: undefined,
      shareId: sharedPattern.id,
    }
  }
  const restored = loadSessionPattern()
  if (restored) return {
    ...restored,
    shareId: restored.shareId ?? null,
  }
  const starter = randomStarter()
  return {
    code: starter.code,
    customTitle: starter.title,
    sourcePrompt: undefined,
    shareId: null,
  }
}

function randomStarter(): ShowcasePattern {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return SHOWCASE_PATTERNS[random % SHOWCASE_PATTERNS.length] ?? SHOWCASE_PATTERNS[0]
}

function transportLabel(state: Playback['playbackState']): string {
  if (state === 'playing' || state === 'loading' || state === 'transitioning') return '■ STOP'
  return '▶ PLAY'
}
