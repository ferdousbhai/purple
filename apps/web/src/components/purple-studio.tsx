import {
  DEFAULT_TRANSITION_CYCLES,
  EXPLANATORY_STYLE_INSTRUCTION,
  PROMPT_MODIFIERS,
  PROMPT_PRESETS,
  TRANSITION_CYCLE_OPTIONS,
  MAX_PATTERN_LENGTH,
  acceptRawPattern,
  generateRandomPrompt,
  patternFilename,
  visibleTextWithoutCodeBlocks,
  withExplanatoryStyle,
  type TransitionSuggestionsResult,
} from '@purple/core'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  clearByokChat,
  createByokBackend,
  getByokKey,
  loadByokChat,
  saveByokChat,
  setByokKey,
} from '#/lib/byok'
import { removePattern, upsertPattern, usePatterns } from '#/lib/patterns'
import {
  hasUnappliedEditorChanges,
  resolveGeneratedPatternMode,
  type PatternMode,
} from '#/lib/playback-flow'
import { usePlayback } from '@purple/ui/use-playback'
import { PatternEditor } from '@purple/ui/pattern-editor'
import { useTransitionSuggestions } from '@purple/ui/use-transition-suggestions'
import { useStudioChat } from '@purple/ui/use-studio-chat'
import { useGeneratedPattern } from '@purple/ui/use-generated-pattern'
import type { SourceRange } from '@purple/core/types'

const STARTER_PATTERNS = [
  's("bd*4").gain(0.8)',
  'stack(s("bd ~ sd ~"), s("hh*8").gain(0.35))',
  'note("<c3 eb3 g3 bb3>").s("sawtooth").slow(2).lpf(700).gain(0.5)',
] as const
const EMPTY_RANGES: readonly SourceRange[] = []
const EQ_BAR_DELAYS = [0, 0.15, 0.3, 0.1, 0.25] as const

type Playback = ReturnType<typeof usePlayback>

export function PurpleStudio() {
  const [byokKey, setByokKeyState] = useState<string | null>(() => getByokKey())
  const [keyPanelOpen, setKeyPanelOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [code, setCode] = useState(() => randomStarter())
  const [customTitle, setCustomTitle] = useState<string | null>(null)
  const [sourcePrompt, setSourcePrompt] = useState<string | undefined>()
  const playback = usePlayback()
  const savedPatterns = usePatterns()
  const editorHasUnappliedChanges = hasUnappliedEditorChanges(
    playback.playbackState,
    code,
    playback.activeCode,
  )

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

  const save = () => {
    // Mirror the pattern schema's bounds; an out-of-range upsert throws.
    if (!code.trim() || code.length > MAX_PATTERN_LENGTH) return
    const now = Date.now()
    const name = title.trim() || 'Untitled Pattern'
    const existing = savedPatterns.find((pattern) => pattern.title === name)
    upsertPattern(
      existing
        ? { ...existing, code, prompt: sourcePrompt, updatedAt: now }
        : {
            id: crypto.randomUUID(),
            title: name,
            code,
            prompt: sourcePrompt,
            createdAt: now,
            updatedAt: now,
          },
    )
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

  const togglePlayback = () => {
    if (playback.playbackState === 'playing') playback.stop()
    else void playback.play(code)
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

  const audible =
    playback.playbackState === 'playing' || playback.playbackState === 'transitioning'
  const ledState =
    audible ? 'active' : playback.playbackState === 'loading' ? 'busy' : 'idle'

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">PURPLE</span>
        </div>
        <div className="topbar-actions">
          <a
            className="chrome"
            href="https://github.com/ferdousbhai/purple"
            rel="noreferrer"
            target="_blank"
          >
            SOURCE
          </a>
          {audible ? <EqBars /> : null}
          <StatusLed state={ledState} />
          <button
            className={`chrome ${libraryOpen ? 'open' : ''}`}
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

      {libraryOpen ? (
        <section className="library-popover">
          {savedPatterns.length === 0 ? (
            <p className="muted">Nothing saved yet — SAVE keeps a pattern in this browser.</p>
          ) : (
            [...savedPatterns]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((pattern) => (
                <div key={pattern.id} className="library-row">
                  <button
                    onClick={() => {
                      setCode(pattern.code)
                      setCustomTitle(pattern.title)
                      setSourcePrompt(pattern.prompt)
                      setLibraryOpen(false)
                    }}
                  >
                    {pattern.title}
                  </button>
                  <button
                    className="delete"
                    aria-label={`Delete ${pattern.title}`}
                    onClick={() => removePattern(pattern.id)}
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
              onChange={(event) => setCustomTitle(event.target.value)}
              maxLength={60}
            />
            <button className="chrome" onClick={save}>SAVE</button>
            <button className="chrome" onClick={exportPattern}>EXPORT</button>
            {editorHasUnappliedChanges ? (
              <button
                className="chrome apply-changes"
                aria-label="Apply editor changes to playback (Ctrl+Enter)"
                title="Apply editor changes (Ctrl+Enter)"
                onClick={() => void playback.play(code)}
              >
                APPLY
              </button>
            ) : null}
            <button
              className={`transport ${playback.playbackState === 'playing' ? 'stop' : 'start'}`}
              disabled={playback.playbackState === 'loading' || playback.playbackState === 'transitioning'}
              onClick={togglePlayback}
            >
              {transportLabel(playback.playbackState)}
            </button>
          </div>

          <div className="editor-surface">
            <PatternEditor
              code={code}
              activeRanges={code === playback.activeCode ? playback.activeRanges : EMPTY_RANGES}
              onCodeChange={setCode}
              // Strudel convention: Mod+Enter always (re-)evaluates, so a live
              // edit mid-playback picks up the new pattern instead of stopping.
              onEvaluate={() => void playback.play(code)}
            />
          </div>

          {playback.error ? <p className="error" role="alert">{playback.error}</p> : null}
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
            <Composer
              byokKey={byokKey}
              code={code}
              playback={playback}
              setCode={setCode}
              setCustomTitle={setCustomTitle}
              setSourcePrompt={setSourcePrompt}
            />
          )}
        </aside>
      </div>
    </main>
  )
}

function EqBars() {
  return (
    <div aria-hidden="true" className="eq-bars">
      {EQ_BAR_DELAYS.map((delay, index) => (
        <span key={index} style={{ animationDelay: `${delay}s` }} />
      ))}
    </div>
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
        Purple has no accounts and keeps no data. Your key, your chat, and your saved patterns
        live only in this browser — generation requests go straight from here to Google.
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

/**
 * Pattern acceptance: retry playback through the repair function, stage or
 * play, and keep next-move suggestions fresh.
 */
function usePatternFlow(deps: {
  playback: Playback
  setCode: (code: string) => void
  setCustomTitle: (title: string | null) => void
  setSourcePrompt: (prompt: string | undefined) => void
  /** Send the prepared repair message; the fixed pattern, or null on failure. */
  requestFix: (message: string) => Promise<string | null>
  /** A repair replaced `broken` with `fixed`: propagate it into the stored
   * transcript, so future generations and compaction folds see the pattern
   * that actually plays — not the mistake the repair just removed. */
  onPatternFixed: (broken: string, fixed: string) => void
  suggest: (code: string, sourcePrompt?: string) => Promise<TransitionSuggestionsResult>
}) {
  const [uiError, setUiError] = useState<string | null>(null)
  const [stagedCode, setStagedCode] = useState<string | null>(null)
  const lastPromptRef = useRef('')
  const playbackRef = useRef(deps.playback)
  playbackRef.current = deps.playback
  const nextMoves = useTransitionSuggestions({
    suggestTransitions: deps.suggest,
  })
  const generatedPattern = useGeneratedPattern({
    validatePattern: deps.playback.validatePattern,
    requestFix: deps.requestFix,
    onCodeChange: deps.setCode,
    onPatternFixed: deps.onPatternFixed,
    playingRevision: {
      getPlayingCode: () => {
        const current = playbackRef.current
        return current.playbackState === 'playing' ? current.activeCode : null
      },
      replace: (fixed) => playbackRef.current.play(fixed),
    },
    isStopped: () => deps.playback.playbackState === 'stopped',
    onPlaybackSuccess: (code, sourcePrompt) =>
      nextMoves.generate({ code, sourcePrompt }),
  })

  useEffect(() => {
    if (nextMoves.error) setUiError(nextMoves.error)
  }, [nextMoves.error])

  const refreshSuggestions = (pattern: string, prompt?: string) => {
    nextMoves.generate({ code: pattern, sourcePrompt: prompt })
  }

  /** Resolves with whether a pattern actually landed in the editor. */
  const acceptPattern = async (pattern: string, mode: PatternMode): Promise<boolean> => {
    const sourcePrompt = lastPromptRef.current
    generatedPattern.adopt(pattern, sourcePrompt)
    deps.setCustomTitle(null)
    deps.setSourcePrompt(sourcePrompt)

    // Audit the pattern against the live engine before it plays or stages:
    // evaluation failures, empty patterns, and sound names that would play
    // silence go back to Gemini as hidden messages. Sends are disabled while
    // a generation (validation repairs included) is in flight.
    const validated = await generatedPattern.validate(pattern)
    if (mode === 'stage') {
      setStagedCode(validated.code)
      return true
    }

    const outcome = await generatedPattern.attempt(
      validated.code,
      deps.playback.play,
    )
    if (outcome.result.ok) {
      setStagedCode(null)
      setUiError(null)
    } else if (outcome.result.kind !== 'cancelled') {
      setUiError(outcome.result.error)
    }
    return true
  }

  return {
    uiError,
    setUiError,
    stagedCode,
    setStagedCode,
    suggestions: nextMoves.suggestions,
    lastPromptRef,
    acceptPattern,
    refreshSuggestions,
  }
}

type PatternFlow = ReturnType<typeof usePatternFlow>

function Composer(props: {
  byokKey: string
  code: string
  playback: Playback
  setCode: (code: string) => void
  setCustomTitle: (title: string | null) => void
  setSourcePrompt: (prompt: string | undefined) => void
}) {
  const [input, setInput] = useState('')
  const [initialChat] = useState(
    () => loadByokChat() ?? { messages: [], artifact: null, coveredCount: 0 },
  )
  const [isAcceptingPattern, setIsAcceptingPattern] = useState(false)
  const [explanatoryStyle, setExplanatoryStyle] = useState(false)
  const patternExplanatoryStyleRef = useRef(false)
  const backend = useMemo(() => createByokBackend(props.byokKey), [props.byokKey])
  const chat = useStudioChat(backend, {
    initialState: initialChat,
    failedPromptPolicy: 'retain',
    onStateChange: saveByokChat,
    onClear: clearByokChat,
  })
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const flow = usePatternFlow({
    playback: props.playback,
    setCode: props.setCode,
    setCustomTitle: props.setCustomTitle,
    setSourcePrompt: props.setSourcePrompt,
    requestFix: async (message) => {
      try {
        const acceptance = acceptRawPattern(
          await backend.repairPattern(
            withExplanatoryStyle(
              message,
              patternExplanatoryStyleRef.current,
            ),
          ),
        )
        return acceptance.ok ? acceptance.pattern : null
      } catch {
        // The evaluation error the fix was for surfaces instead.
        return null
      }
    },
    onPatternFixed: chat.replaceLastAssistantPattern,
    suggest: backend.suggestTransitions,
  })

  useEffect(() => {
    if (
      flow.stagedCode &&
      props.playback.playbackState === 'playing' &&
      props.playback.activeCode === props.code
    ) {
      flow.setStagedCode(null)
    }
  }, [
    flow.setStagedCode,
    flow.stagedCode,
    props.code,
    props.playback.activeCode,
    props.playback.playbackState,
  ])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [chat.messages, chat.isStreaming, chat.streamingText, isAcceptingPattern])

  const busy =
    chat.isStreaming ||
    isAcceptingPattern ||
    props.playback.playbackState === 'transitioning'
  const streamingProse = visibleTextWithoutCodeBlocks(chat.streamingText)

  const send = (text: string, mode: PatternMode = 'play') => {
    const prompt = text.trim()
    if (!prompt || busy) return
    flow.lastPromptRef.current = prompt
    patternExplanatoryStyleRef.current = explanatoryStyle
    flow.setUiError(null)
    const resolvedMode = resolveGeneratedPatternMode(mode, props.playback.playbackState)
    const patternPromise = chat.sendMessage(prompt, {
      requestInstruction: explanatoryStyle
        ? EXPLANATORY_STYLE_INSTRUCTION
        : undefined,
    })
    void props.playback.prepareAudio()
    setInput('')
    // Ask for a title in parallel with the pattern; sends are disabled while
    // generating, so the result can only belong to this prompt.
    const titlePromise = backend.generateTitle(prompt)
    void patternPromise
      .then(async (pattern) => {
        if (!pattern) return
        // Keep sends disabled through validation and repair round-trips.
        setIsAcceptingPattern(true)
        const landed = await flow.acceptPattern(pattern, resolvedMode)
        if (landed) {
          const title = await titlePromise
          if (title.ok) props.setCustomTitle(title.title)
        }
      })
      .finally(() => {
        setIsAcceptingPattern(false)
      })
  }

  const clearSession = () => {
    chat.clearChat()
    flow.setUiError(null)
    flow.setStagedCode(null)
    setInput('')
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(input)
    }
  }

  const isEmpty = chat.messages.length === 0
  // The playback poll re-renders this component up to 20x/s while playing;
  // don't re-strip code fences from the whole transcript on each frame.
  const transcript = useMemo(
    () =>
      chat.messages.map((message) => ({
        key: message.id,
        role: message.role,
        prose: visibleTextWithoutCodeBlocks(message.content),
      })),
    [chat.messages],
  )
  const sessionError = flow.uiError ?? chat.error

  return (
    <section className="composer">
      <div className="session-bar">
        <button
          className="new-session"
          title="Clear the conversation and start a new session"
          aria-label="Clear session and start over"
          // Disabled while busy: the settled generation would write the old
          // conversation right back over a mid-flight clear.
          disabled={busy || (isEmpty && !input.trim())}
          onClick={clearSession}
        >
          <span aria-hidden="true" className="new-session-mark">＋</span>
          START NEW SESSION
        </button>
      </div>

      {isEmpty ? (
        <div className="empty-session">
          <div>
            <h2>What do you want to hear?</h2>
            <p>describe it, or start from a recipe</p>
          </div>
          <div className="preset-grid">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                disabled={busy}
                onClick={() => send(preset.prompt)}
              >
                <span className="preset-title">{preset.emoji} {preset.title}</span>
                <span className="preset-genre">{preset.genre}</span>
              </button>
            ))}
          </div>
          <button className="random" disabled={busy} onClick={() => send(generateRandomPrompt())}>
            🎲 Random pattern
          </button>
        </div>
      ) : (
        <div className="transcript" aria-live="polite" ref={transcriptRef}>
          {transcript.map((message) =>
            message.prose ? (
              <p key={message.key} className={message.role}>{message.prose}</p>
            ) : null,
          )}
          {streamingProse ? (
            <p className="assistant streaming">{streamingProse}</p>
          ) : null}
          {busy && !streamingProse ? (
            <span className="stream-dots" aria-label="Generating">
              <span>.</span><span>.</span><span>.</span>
            </span>
          ) : null}
        </div>
      )}

      {chat.suggestNewSession && !isEmpty ? (
        <div className="session-nudge" role="status">
          <span>This session is getting long. Start fresh for the clearest results.</span>
          <button
            className="chrome"
            disabled={busy}
            onClick={clearSession}
          >
            START OVER
          </button>
        </div>
      ) : null}

      {!isEmpty ? (
        <div className="chip-row">
          <span className="chip-label">EFFECT</span>
          {PROMPT_MODIFIERS.map((modifier) => (
            <button
              key={modifier.id}
              className="chip"
              disabled={busy}
              title={modifier.prompt}
              onClick={() => send(modifier.prompt)}
            >
              {modifier.label}
            </button>
          ))}
        </div>
      ) : null}

      {flow.suggestions.length > 0 ? (
        <div className="chip-row next">
          <span className="chip-label">NEXT</span>
          {flow.suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              className="chip"
              disabled={busy}
              title={suggestion.prompt}
              onClick={() => send(suggestion.prompt, 'stage')}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}

      {flow.stagedCode ? (
        <MixRow code={props.code} flow={flow} playback={props.playback} />
      ) : null}

      {sessionError ? <p className="error" role="alert">{sessionError}</p> : null}

      <form
        className="prompt-form"
        onSubmit={(event) => {
          event.preventDefault()
          send(input)
        }}
      >
        <label className="explanatory-toggle">
          <input
            type="checkbox"
            checked={explanatoryStyle}
            disabled={busy}
            onChange={(event) => setExplanatoryStyle(event.target.checked)}
          />
          <strong>Explanatory</strong>
          <span>comment every line</span>
        </label>
        <textarea
          aria-label="Describe the music"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={busy ? 'generating…' : 'describe your sound…'}
          rows={2}
          maxLength={4000}
        />
        <button className="primary" disabled={busy || !input.trim()}>SEND</button>
      </form>
    </section>
  )
}

function MixRow(props: { code: string; flow: PatternFlow; playback: Playback }) {
  const { code, flow, playback } = props
  const [transitionCycles, setTransitionCycles] = useState(DEFAULT_TRANSITION_CYCLES)
  const mixing = playback.playbackState === 'transitioning'
  return (
    <div className="mix-row">
      <span className="chip-label">READY</span>
      {TRANSITION_CYCLE_OPTIONS.map((cycles) => (
        <button
          key={cycles}
          className={`chip ${transitionCycles === cycles ? 'selected' : ''}`}
          disabled={mixing}
          title={`Crossfade over ${cycles} cycles`}
          onClick={() => setTransitionCycles(cycles)}
        >
          {cycles}
        </button>
      ))}
      <button
        className="primary"
        disabled={mixing}
        onClick={() => {
          if (!flow.stagedCode) return
          void playback.transition(code, transitionCycles).then((result) => {
            if (!result.ok) return
            flow.setStagedCode(null)
            void flow.refreshSuggestions(code, flow.lastPromptRef.current)
          })
        }}
      >
        {mixing ? 'XFADING…' : 'XFADE'}
      </button>
    </div>
  )
}

/** A default title from the generating prompt, so saved patterns don't collide. */
function titleFromPrompt(prompt: string | undefined): string | null {
  const text = prompt?.trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.length <= 48 ? text : `${text.slice(0, 47).trimEnd()}…`
}

function randomStarter(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return STARTER_PATTERNS[random % STARTER_PATTERNS.length] ?? STARTER_PATTERNS[0]
}

function transportLabel(state: Playback['playbackState']): string {
  if (state === 'playing') return '■ STOP'
  if (state === 'loading') return 'PLAY…'
  if (state === 'transitioning') return 'MIXING…'
  return '▶ PLAY'
}
