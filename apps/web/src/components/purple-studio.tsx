import {
  MAX_PATTERN_LENGTH,
  patternFilename,
  validatePatternTitle,
  validatePatternCode,
} from '@purple/core/pattern'
import { describeValidationProblem } from '@purple/core/validation'
import { SHOWCASE_PATTERNS, type ShowcasePattern } from '@purple/core/showcase-patterns'
import type { SharedPattern } from '@purple/core/shared-pattern'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { InternalLink, type NavigateInApp } from './internal-link'
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
  loadAgentLinkSettings,
  type AgentLinkSettings,
} from '#/lib/agent-link-storage'
import { PurpleMark } from '@purple/ui/purple-mark'
import { useAgentLink } from '@purple/ui/use-agent-link'
import { SpectrumBars } from '@purple/ui/spectrum-bars'
import {
  hasUnappliedEditorChanges,
  isTransportActive,
  usePlayback,
} from '@purple/ui/use-playback'
import type { PatternEditorProps } from '@purple/ui/pattern-editor'
import { WEB_AUDIO_OPTIONS, type WebPlayback } from '#/lib/playback'

const PatternEditor = lazy(async () => {
  const editor = await import('@purple/ui/pattern-editor')
  return { default: editor.PatternEditor }
})
const AgentCard = lazy(async () => {
  const card = await import('./agent-card')
  return { default: card.AgentCard }
})
const FeedbackDialog = lazy(async () => {
  const feedback = await import('./feedback-dialog')
  return { default: feedback.FeedbackDialog }
})
const ShareDialog = lazy(async () => {
  const share = await import('./share-dialog')
  return { default: share.ShareDialog }
})

const LIBRARY_WRITE_ERROR =
  'This browser could not update the library. Allow site data and try again.'

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
  const [agentLink] = useState<AgentLinkSettings>(loadAgentLinkSettings)
  // The pairing panel is the whole session pane. It steps aside once an agent
  // is actually driving the tab, and the topbar badge brings it back.
  const [agentPanelOpen, setAgentPanelOpen] = useState(true)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [libraryWasCleared, setLibraryWasCleared] = useState(false)
  const [patternStorageError, setPatternStorageError] = useState<string | null>(null)
  const [initialPattern] = useState(() => loadInitialPattern(sharedPattern))
  const [code, setCode] = useState(initialPattern.code)
  const [customTitle, setCustomTitle] = useState(initialPattern.customTitle)
  const [shareId, setShareId] = useState<string | null>(initialPattern.shareId)
  const isPhoneWidth = usePhoneWidth()
  const savedPatterns = usePatterns()
  const mainRef = useRef<HTMLElement | null>(null)
  const libraryRef = useRef<HTMLElement | null>(null)
  const libraryButtonRef = useRef<HTMLButtonElement | null>(null)
  const editorHasUnappliedChanges = hasUnappliedEditorChanges(
    playback.playbackState,
    code,
    playback.activeCode,
  )
  const commitCode = useCallback((nextCode: string) => {
    setCode(nextCode)
    setShareId(null)
  }, [])
  const commitCustomTitle = useCallback((nextTitle: string | null) => {
    setCustomTitle(nextTitle)
    setShareId(null)
  }, [])

  useEffect(() => {
    saveSessionPattern({ code, customTitle, shareId: shareId ?? undefined })
  }, [code, customTitle, shareId])

  const title = customTitle ?? 'Untitled Pattern'
  const patternName = title.trim() || 'Untitled Pattern'
  const patternIsSavable = validatePatternCode(code) !== null

  // The agent can send set_pattern and play back to back, faster than React
  // re-renders the handler closures; refs keep the served code current.
  const codeRef = useRef(code)
  codeRef.current = code
  const patternNameRef = useRef(patternName)
  patternNameRef.current = patternName
  const agentLinked = useAgentLink({
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
          const nextTitle = validatePatternTitle(rawTitle)
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

  useEffect(() => {
    // Setup is done the moment an agent answers, so hand the room back to the
    // editor. Reopening stays a deliberate click on the topbar badge.
    if (agentLinked) setAgentPanelOpen(false)
  }, [agentLinked])

  const libraryPattern = savedPatterns.find(
    (pattern) =>
      (shareId !== null && pattern.shareId === shareId) ||
      (pattern.title === patternName && pattern.code === code),
  )
  const currentPatternSaved = libraryPattern !== undefined

  const toggleSavedPattern = () => {
    if (!patternIsSavable) return
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
        shareId: targetShareId ?? undefined,
        createdAt: now,
        updatedAt: now,
      })
      if (!targetShareId && savedTitle !== patternName) {
        commitCustomTitle(savedTitle)
      }
    }
    if (!persisted) {
      setPatternStorageError(LIBRARY_WRITE_ERROR)
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
    void playback.play(code)
  }

  const togglePlayback = () => {
    if (isTransportActive(playback.playbackState)) playback.stop()
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
          <button
            className={`chrome agent-badge ${agentPanelOpen ? 'open' : ''}`}
            aria-expanded={agentPanelOpen}
            title={
              agentLinked
                ? 'Your agent is driving this tab. Click for the link.'
                : 'No agent yet. Click for the link.'
            }
            onClick={() => setAgentPanelOpen((open) => !open)}
          >
            AGENT
            <span
              className={`agent-dot ${agentLinked ? 'linked' : ''}`}
              aria-hidden="true"
            />
            <span className="sr-only">{agentLinked ? ' linked' : ' waiting'}</span>
          </button>
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
                    onClick={() => {
                      commitCode(pattern.code)
                      commitCustomTitle(pattern.title)
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
                        setPatternStorageError(LIBRARY_WRITE_ERROR)
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

      <div className={`studio-grid ${agentPanelOpen ? '' : 'editor-only'}`}>
        <section className="editor-pane">
          <div className="editor-bar">
            <input
              className="title-input"
              aria-label="Pattern title"
              name="pattern-title"
              value={title}
              onChange={(event) => commitCustomTitle(event.target.value)}
              maxLength={60}
            />
            <button
              className={`chrome ${currentPatternSaved ? 'saved' : ''}`}
              disabled={!patternIsSavable}
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
              disabled={!patternIsSavable}
              onClick={() => setShareOpen(true)}
            >
              SHARE
            </button>
            <button className="chrome export" onClick={exportPattern}>
              EXPORT
            </button>
            {editorHasUnappliedChanges ? (
              <button
                className="chrome apply-changes"
                aria-label="Apply editor changes to playback (Ctrl+Enter)"
                title="Apply editor changes (Ctrl+Enter)"
                onClick={playCurrentPattern}
              >
                APPLY
              </button>
            ) : null}
            <button
              className={`transport ${audible || playback.playbackState === 'loading' ? 'stop' : 'start'}`}
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

        {agentPanelOpen ? (
          <Suspense fallback={<aside className="session-pane" aria-busy="true" />}>
            <AgentCard code={agentLink.code} linked={agentLinked} />
          </Suspense>
        ) : null}
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

function loadInitialPattern(sharedPattern?: SharedPattern) {
  if (sharedPattern) {
    return {
      code: sharedPattern.code,
      customTitle: sharedPattern.title,
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
    shareId: null,
  }
}

function randomStarter(): ShowcasePattern {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return SHOWCASE_PATTERNS[random % SHOWCASE_PATTERNS.length] ?? SHOWCASE_PATTERNS[0]
}

function transportLabel(state: Playback['playbackState']): string {
  return isTransportActive(state) ? '■ STOP' : '▶ PLAY'
}
