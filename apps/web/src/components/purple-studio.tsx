import { MAX_PATTERN_LENGTH, patternFilename } from '@purple/core/pattern'
import { SHOWCASE_PATTERNS, type ShowcasePattern } from '@purple/core/recipes'
import type { SharedPattern } from '@purple/core/shared-pattern'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { GeneratedPatternController } from './composer'
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
import { hasUnappliedEditorChanges } from '@purple/ui/playback-flow'
import { PurpleMark } from '@purple/ui/purple-mark'
import { SpectrumBars } from '@purple/ui/spectrum-bars'
import { usePlayback } from '@purple/ui/use-playback'
import type { PatternEditorProps } from '@purple/ui/pattern-editor'
import { WEB_AUDIO_OPTIONS } from '#/lib/playback'
import { voteForPattern } from '#/lib/public-patterns'

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

type Playback = ReturnType<typeof usePlayback>

export function PurpleStudio({ sharedPattern }: { sharedPattern?: SharedPattern }) {
  const [byokKey, setByokKeyState] = useState<string | null>(() => getByokKey())
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
  const [patternPreview, setPatternPreview] = useState<string | null>(null)
  const [patternPending, setPatternPending] = useState(false)
  const [patternProvisional, setPatternProvisional] = useState(false)
  const [customTitle, setCustomTitle] = useState(initialPattern.customTitle)
  const [sourcePrompt, setSourcePrompt] = useState(initialPattern.sourcePrompt)
  const [shareId, setShareId] = useState<string | null>(initialPattern.shareId)
  const [viewerVote, setViewerVote] = useState(initialPattern.viewerVote)
  const [likePending, setLikePending] = useState(false)
  const shareIdRef = useRef(shareId)
  shareIdRef.current = shareId
  const playback = usePlayback(WEB_AUDIO_OPTIONS)
  const isPhoneWidth = usePhoneWidth()
  const savedPatterns = usePatterns()
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
  const patternLocked = patternPreview !== null || patternPending
  const editorHasUnappliedChanges = hasUnappliedEditorChanges(
    playback.playbackState,
    code,
    playback.activeCode,
  )
  const commitGeneratedCode = useCallback((nextCode: string) => {
    setPatternPreview(null)
    setCode(nextCode)
    setShareId(null)
    setViewerVote(0)
  }, [])
  const commitCode = useCallback((nextCode: string) => {
    codeRevisionRef.current++
    generatedPatternControllerRef.current?.invalidate()
    commitGeneratedCode(nextCode)
  }, [commitGeneratedCode])
  const commitCustomTitle = useCallback((nextTitle: string | null) => {
    titleRevisionRef.current++
    setCustomTitle(nextTitle)
    setShareId(null)
    setViewerVote(0)
  }, [])

  useEffect(() => {
    if (patternProvisional) return
    saveSessionPattern({ code, customTitle, sourcePrompt, shareId: shareId ?? undefined })
  }, [code, customTitle, patternProvisional, shareId, sourcePrompt])

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
  const libraryPattern = savedPatterns.find(
    (pattern) =>
      (shareId !== null && pattern.shareId === shareId) ||
      (pattern.title === patternName && pattern.code === code),
  )
  const currentPatternLiked = libraryPattern !== undefined || viewerVote === 1

  const toggleLike = async () => {
    // Mirror the pattern schema's bounds; an out-of-range upsert throws.
    if (!code.trim() || code.length > MAX_PATTERN_LENGTH) return
    if (likePending) return
    setLikePending(true)
    const targetShareId = shareId
    try {
      let persisted = true
      if (currentPatternLiked) {
        if (libraryPattern) persisted = removePattern(libraryPattern.id)
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
      if (targetShareId) {
        try {
          const vote = await voteForPattern(
            targetShareId,
            currentPatternLiked ? 0 : 1,
          )
          if (shareIdRef.current === targetShareId) {
            setViewerVote(vote.viewerVote)
          }
        } catch {
          setPatternStorageError(
            currentPatternLiked
              ? 'Removed from this library, but the public like could not be removed.'
              : 'Added to this library, but the public like could not be recorded.',
          )
        }
      }
    } finally {
      setLikePending(false)
    }
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

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <PurpleMark className="brand-mark" />
          <span className="brand-name">PURPLE</span>
        </div>
        <div className="topbar-actions">
          <a
            className="chrome patterns-link"
            href="/patterns"
          >
            PATTERNS
          </a>
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
          {audible ? (
            <SpectrumBars className="eq-bars" getAnalyser={playback.getOutputAnalyser} />
          ) : null}
          <StatusLed state={ledState} />
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
            className={`chrome ${keyPanelOpen ? 'open' : ''}`}
            onClick={() => setKeyPanelOpen((open) => !open)}
          >
            {byokKey ? 'KEY ✓' : 'KEY'}
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
            title={patternName}
            onClose={() => setShareOpen(false)}
            onShared={(id, sharedTitle) => {
              commitCustomTitle(sharedTitle)
              setShareId(id)
              setViewerVote(0)
            }}
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
                ? 'Library is clean. No liked patterns.'
                : 'Nothing liked yet. LIKE keeps a pattern in this browser.'}
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
                      setViewerVote(0)
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
                      if (pattern.shareId) {
                        void voteForPattern(pattern.shareId, 0)
                          .then((vote) => {
                            if (shareIdRef.current === pattern.shareId) {
                              setViewerVote(vote.viewerVote)
                            }
                          })
                          .catch(() => {
                            setPatternStorageError(
                              'Removed from this library, but the public like could not be removed.',
                            )
                          })
                      }
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
              value={title}
              disabled={patternLocked}
              onChange={(event) => commitCustomTitle(event.target.value)}
              maxLength={60}
            />
            <button
              className={`chrome ${currentPatternLiked ? 'liked' : ''}`}
              disabled={patternLocked || likePending}
              onClick={() => void toggleLike()}
              title={
                currentPatternLiked
                  ? 'Remove from this browser’s library'
                  : 'Like and add to this browser’s library'
              }
            >
              <span aria-live="polite">{currentPatternLiked ? '♥ LIKED' : '♡ LIKE'}</span>
            </button>
            <button
              className="chrome"
              disabled={patternLocked || !code.trim() || code.length > MAX_PATTERN_LENGTH}
              onClick={() => setShareOpen(true)}
            >
              SHARE
            </button>
            <button
              className="chrome export"
              disabled={patternLocked}
              onClick={exportPattern}
            >
              EXPORT
            </button>
            {editorHasUnappliedChanges ? (
              <button
                className="chrome apply-changes"
                aria-label="Apply editor changes to playback (Ctrl+Enter)"
                title="Apply editor changes (Ctrl+Enter)"
                disabled={patternLocked}
                onClick={playCurrentPattern}
              >
                APPLY
              </button>
            ) : null}
            <button
              className={`transport ${audible || playback.playbackState === 'loading' ? 'stop' : 'start'}`}
              disabled={patternLocked && !audible}
              onClick={togglePlayback}
            >
              {transportLabel(playback.playbackState)}
            </button>
          </div>

          <div className="editor-surface">
            <DeferredPatternEditor
              code={patternPreview ?? code}
              playbackHighlightActive={
                playback.playbackState === 'playing' &&
                patternPreview === null &&
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
          {!byokKey || keyPanelOpen ? (
            <KeyCard
              byokKey={byokKey}
              onSave={(key) => {
                const stored = updateByokKey(key)
                if (stored) setKeyPanelOpen(false)
                return stored
              }}
              onClose={byokKey ? () => setKeyPanelOpen(false) : undefined}
            />
          ) : (
            <Suspense fallback={<section className="composer" aria-busy="true" />}>
              <Composer
                byokKey={byokKey}
                code={code}
                customTitle={customTitle}
                sourcePrompt={sourcePrompt}
                playback={playback}
                setCode={commitGeneratedCode}
                setPatternPreview={setPatternPreview}
                setPatternPending={setPatternPending}
                setPatternProvisional={setPatternProvisional}
                getCodeRevision={getCodeRevision}
                getTitleRevision={getTitleRevision}
                registerGeneratedPatternController={registerGeneratedPatternController}
                setCustomTitle={commitCustomTitle}
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
  return <div aria-label={`Status: ${state}`} role="status" className={`status-led ${state}`} />
}

function KeyCard(props: {
  byokKey: string | null
  onSave: (key: string | null) => boolean
  onClose?: () => void
}) {
  const [draft, setDraft] = useState('')
  const [storageBlocked, setStorageBlocked] = useState(false)
  return (
    <section className="key-card">
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
          if (draft.trim()) setStorageBlocked(!props.onSave(draft))
        }}
      >
        <input
          type="password"
          aria-label="Gemini API key"
          placeholder={props.byokKey ? 'A key is saved in this browser' : 'AIza…'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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

/** A default title from the generating prompt, so saved patterns do not collide. */
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
      viewerVote: sharedPattern.viewerVote,
    }
  }
  const restored = loadSessionPattern()
  if (restored) return {
    ...restored,
    shareId: restored.shareId ?? null,
    viewerVote: 0 as const,
  }
  const starter = randomStarter()
  return {
    code: starter.code,
    customTitle: starter.title,
    sourcePrompt: undefined,
    shareId: null,
    viewerVote: 0 as const,
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
