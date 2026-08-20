import {
  DEFAULT_TRANSITION_CYCLES,
  PROMPT_MODIFIERS,
  PROMPT_PRESETS,
  TRANSITION_CYCLE_OPTIONS,
  errorMessage,
  extractPattern,
  generateRandomPrompt,
  patternFilename,
  planCompaction,
  visibleTextWithoutCodeBlocks,
  type TransitionSuggestion,
} from '@purple/core'
import { javascript } from '@codemirror/lang-javascript'
import { Prec } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap, type EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { useLiveQuery } from '@tanstack/react-db'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  byokGeneratePattern,
  byokRepairPattern,
  byokSuggestTransitions,
  clearByokChat,
  generateCompactionSummary,
  getByokKey,
  loadByokChat,
  saveByokChat,
  setByokKey,
  type ByokChatState,
} from '#/lib/byok'
import { getPatternsCollection } from '#/db-collections'
import { usePlayback } from '@purple/ui/use-playback'
import {
  playbackHighlightExtension,
  updatePlaybackHighlights,
} from '@purple/ui/playback-highlight'
import type { SourceRange } from '@purple/core/types'

const STARTER_PATTERNS = [
  's("bd*4").gain(0.8)',
  'stack(s("bd ~ sd ~"), s("hh*8").gain(0.35))',
  'note("<c3 eb3 g3 bb3>").s("sawtooth").slow(2).lpf(700).gain(0.5)',
] as const
const EMPTY_RANGES: readonly SourceRange[] = []
const EQ_BAR_DELAYS = [0, 0.15, 0.3, 0.1, 0.25] as const

type Playback = ReturnType<typeof usePlayback>
type PatternMode = 'play' | 'stage'

export function PurpleStudio() {
  const [byokKey, setByokKeyState] = useState<string | null>(() => getByokKey())
  const [keyPanelOpen, setKeyPanelOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [code, setCode] = useState(() => randomStarter())
  const [customTitle, setCustomTitle] = useState<string | null>(null)
  const [sourcePrompt, setSourcePrompt] = useState<string | undefined>()
  const playback = usePlayback()
  const patterns = getPatternsCollection()
  const { data: savedPatterns = [] } = useLiveQuery((query) =>
    query.from({ pattern: patterns }),
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
    // Mirror the collection schema's bounds; an out-of-range insert throws.
    if (!code.trim() || code.length > 30_000) return
    const now = Date.now()
    const name = title.trim() || 'Untitled Pattern'
    const existing = savedPatterns.find((pattern) => pattern.title === name)
    if (existing) {
      patterns.update(existing.id, (draft) => {
        draft.code = code
        draft.prompt = sourcePrompt
        draft.updatedAt = now
      })
      return
    }
    patterns.insert({
      id: crypto.randomUUID(),
      title: name,
      code,
      prompt: sourcePrompt,
      createdAt: now,
      updatedAt: now,
    })
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
          <span className="brand-tag">web</span>
        </div>
        <div className="topbar-actions">
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
                    onClick={() => patterns.delete(pattern.id)}
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
            <button
              className={`transport ${playback.playbackState === 'playing' ? 'stop' : 'start'}`}
              disabled={playback.playbackState === 'loading' || playback.playbackState === 'transitioning'}
              onClick={togglePlayback}
            >
              {transportLabel(playback.playbackState)}
            </button>
          </div>

          <PatternEditor
            code={code}
            ranges={code === playback.activeCode ? playback.activeRanges : EMPTY_RANGES}
            setCode={setCode}
            // Strudel convention: Ctrl+Enter always (re-)evaluates, so a live
            // edit mid-playback picks up the new pattern instead of stopping.
            onEvaluate={() => void playback.play(code)}
          />

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

function PatternEditor(props: {
  code: string
  ranges: readonly SourceRange[]
  setCode: (code: string) => void
  onEvaluate: () => void
}) {
  const viewRef = useRef<EditorView | null>(null)
  const evaluateRef = useRef(props.onEvaluate)
  evaluateRef.current = props.onEvaluate
  const extensions = useMemo(
    () => [
      javascript(),
      playbackHighlightExtension,
      Prec.high(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              evaluateRef.current()
              return true
            },
          },
        ]),
      ),
    ],
    [],
  )
  useEffect(() => {
    // CodeMirror owns its decoration state outside React; synchronize only the
    // active scheduler ranges whenever Strudel reports a change.
    if (viewRef.current) updatePlaybackHighlights(viewRef.current, props.ranges)
  }, [props.ranges])

  return (
    <div className="editor-surface">
      <CodeMirror
        value={props.code}
        height="100%"
        theme={oneDark}
        extensions={extensions}
        onChange={props.setCode}
        onCreateEditor={(view) => {
          viewRef.current = view
          updatePlaybackHighlights(view, props.ranges)
        }}
        basicSetup={{ foldGutter: false, highlightActiveLine: true }}
      />
    </div>
  )
}

/**
 * Pattern acceptance: extract the pattern, retry playback through the repair
 * function, stage or play, and keep next-move suggestions fresh.
 */
function usePatternFlow(deps: {
  playback: Playback
  setCode: (code: string) => void
  setCustomTitle: (title: string | null) => void
  setSourcePrompt: (prompt: string | undefined) => void
  repair: (code: string, error: string) => Promise<string>
  suggest: (code: string, sourcePrompt?: string) => Promise<TransitionSuggestion[]>
}) {
  const [uiError, setUiError] = useState<string | null>(null)
  const [stagedCode, setStagedCode] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<TransitionSuggestion[]>([])
  const lastPromptRef = useRef('')

  const refreshSuggestions = async (pattern: string, prompt?: string) => {
    try {
      setSuggestions(await deps.suggest(pattern, prompt))
    } catch (cause) {
      setUiError(errorMessage(cause))
    }
  }

  const acceptPattern = async (raw: string, mode: PatternMode) => {
    const sourcePrompt = lastPromptRef.current
    let pattern = extractPattern(raw)
    if (!pattern) {
      setUiError('Gemini did not return a Strudel pattern.')
      return
    }
    if (pattern.length > 30_000) {
      setUiError('Gemini returned a pattern larger than 30,000 characters.')
      return
    }

    deps.setCode(pattern)
    deps.setCustomTitle(null)
    deps.setSourcePrompt(sourcePrompt)
    if (mode === 'stage') {
      setStagedCode(pattern)
      return
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await deps.playback.play(pattern)
      if (result.ok) {
        setStagedCode(null)
        setUiError(null)
        void refreshSuggestions(pattern, sourcePrompt)
        return
      }
      if (result.kind !== 'evaluation' || attempt === 2) {
        if (result.kind !== 'cancelled') setUiError(result.error)
        return
      }
      let repaired: string
      try {
        repaired = await deps.repair(pattern, result.error)
      } catch (cause) {
        setUiError(errorMessage(cause))
        return
      }
      pattern = extractPattern(repaired) ?? ''
      if (!pattern) {
        setUiError('Gemini returned an invalid repaired pattern.')
        return
      }
      deps.setCode(pattern)
    }
  }

  return {
    uiError,
    setUiError,
    stagedCode,
    setStagedCode,
    suggestions,
    lastPromptRef,
    acceptPattern,
    refreshSuggestions,
  }
}

type PatternFlow = ReturnType<typeof usePatternFlow>

function Composer(props: {
  byokKey: string
  playback: Playback
  setCode: (code: string) => void
  setCustomTitle: (title: string | null) => void
  setSourcePrompt: (prompt: string | undefined) => void
}) {
  const [input, setInput] = useState('')
  const [chat, setChat] = useState<ByokChatState>(
    () => loadByokChat() ?? { messages: [], artifact: null, coveredCount: 0 },
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const compactionInFlight = useRef(false)
  // Consecutive fold failures; after 3 the effect stops retrying so a
  // persistently failing summarizer can't spend the visitor's key on every
  // message. A successful fold resets it.
  const compactionFailures = useRef(0)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const flow = usePatternFlow({
    playback: props.playback,
    setCode: props.setCode,
    setCustomTitle: props.setCustomTitle,
    setSourcePrompt: props.setSourcePrompt,
    repair: (code, error) => byokRepairPattern(props.byokKey, code, error),
    suggest: (code, sourcePrompt) => byokSuggestTransitions(props.byokKey, code, sourcePrompt),
  })

  // Persist every change, then fold older history into the rolling summary in
  // the background when it has grown past the trigger. The fold never blocks
  // a send — a generation that starts mid-fold uses the previous summary
  // state, and buildContextWindow caps the uncovered tail regardless.
  useEffect(() => {
    saveByokChat(chat)
    if (compactionInFlight.current) return
    if (compactionFailures.current >= 3) return
    const plan = planCompaction(chat.messages.length, chat.coveredCount)
    if (!plan.fold) return

    const folded = chat.messages.slice(0, plan.foldEnd)
    const startCovered = chat.coveredCount
    compactionInFlight.current = true
    void generateCompactionSummary(props.byokKey, chat.artifact, folded.slice(startCovered))
      .then((artifact) => {
        setChat((current) => {
          // Accept only if the folded messages are still a prefix of the
          // live conversation; message objects are stable across appends.
          if (current.coveredCount !== startCovered) return current
          if (current.messages.length < folded.length) return current
          for (let index = 0; index < folded.length; index += 1) {
            if (current.messages[index] !== folded[index]) return current
          }
          return { ...current, artifact, coveredCount: folded.length }
        })
        compactionFailures.current = 0
      })
      .catch(() => {
        // A failed fold keeps the previous state; the plain trim still applies.
        compactionFailures.current += 1
      })
      .finally(() => {
        compactionInFlight.current = false
      })
  }, [chat, props.byokKey])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [chat.messages, isGenerating])

  const busy = isGenerating || props.playback.playbackState === 'transitioning'

  const send = (text: string, mode: PatternMode = 'play') => {
    const prompt = text.trim()
    if (!prompt || busy) return
    const history = [...chat.messages, { role: 'user' as const, text: prompt }]
    const compaction = { artifact: chat.artifact, coveredCount: chat.coveredCount }
    setChat((current) => ({ ...current, messages: history }))
    flow.lastPromptRef.current = prompt
    flow.setUiError(null)
    setIsGenerating(true)
    void props.playback.prepareAudio()
    setInput('')
    void byokGeneratePattern(props.byokKey, history, compaction)
      .then(async (raw) => {
        setChat((current) => ({
          ...current,
          messages: [...history, { role: 'assistant', text: raw }],
        }))
        // isGenerating stays true through acceptPattern's repair round-trips.
        await flow.acceptPattern(raw, mode)
      })
      .catch((cause: unknown) => flow.setUiError(errorMessage(cause)))
      .finally(() => setIsGenerating(false))
  }

  const clearSession = () => {
    clearByokChat()
    setChat({ messages: [], artifact: null, coveredCount: 0 })
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
      chat.messages.map((message, index) => ({
        key: index,
        role: message.role,
        prose: visibleTextWithoutCodeBlocks(message.text),
      })),
    [chat.messages],
  )

  return (
    <section className="composer">
      <div className="session-bar">
        <span className="session-label">SESSION</span>
        <button
          className="chrome reset"
          title="Start over"
          aria-label="Clear session and start over"
          // Disabled while busy: the settled generation would write the old
          // conversation right back over a mid-flight clear.
          disabled={busy || (isEmpty && !input.trim())}
          onClick={clearSession}
        >
          ↺
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
          {busy ? (
            <span className="stream-dots" aria-label="Generating">
              <span>.</span><span>.</span><span>.</span>
            </span>
          ) : null}
        </div>
      )}

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
        <MixRow flow={flow} playback={props.playback} />
      ) : null}

      {flow.uiError ? <p className="error" role="alert">{flow.uiError}</p> : null}

      <form
        className="prompt-form"
        onSubmit={(event) => {
          event.preventDefault()
          send(input)
        }}
      >
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

function MixRow(props: { flow: PatternFlow; playback: Playback }) {
  const { flow, playback } = props
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
          const staged = flow.stagedCode
          if (!staged) return
          void playback.transition(staged, transitionCycles).then((result) => {
            if (!result.ok) return
            flow.setStagedCode(null)
            void flow.refreshSuggestions(staged, flow.lastPromptRef.current)
          })
        }}
      >
        {mixing ? 'MIXING…' : 'MIX IN'}
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
