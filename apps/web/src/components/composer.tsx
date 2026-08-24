import {
  DEFAULT_TRANSITION_CYCLES,
  EXPLANATORY_STYLE_INSTRUCTION,
  PROMPT_MODIFIERS,
  PROMPT_PRESETS,
  TRANSITION_CYCLE_OPTIONS,
  acceptRawPattern,
  generateRandomPrompt,
  visibleTextWithoutCodeBlocks,
  withExplanatoryStyle,
  type TransitionSuggestionsResult,
} from '@purple/core'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  clearByokChat,
  createByokBackend,
  loadByokChat,
  saveByokChat,
} from '#/lib/byok'
import {
  generatedPlaybackFailureMessage,
  isTransitionInfrastructureFailure,
  isValidatedGeneratedPattern,
  resolveGeneratedPatternMode,
  TRANSITION_ERROR,
  validationFailureMessage,
  type PatternMode,
} from '@purple/ui/playback-flow'
import { useGeneratedPattern } from '@purple/ui/use-generated-pattern'
import type { usePlayback } from '@purple/ui/use-playback'
import { useStudioChat } from '@purple/ui/use-studio-chat'
import { useTransitionSuggestions } from '@purple/ui/use-transition-suggestions'

const UNDO_CLEAR_WINDOW_MS = 10_000
const AUTO_XFADE_DELAY_MS = 5_000
const AUTO_XFADE_TICK_MS = 250

type Playback = ReturnType<typeof usePlayback>

interface StagedTransitionOptions {
  /** Refuse an automatic transition if its original pattern stopped or changed. */
  expectedActiveCode?: string
}

/**
 * Pattern acceptance: retry playback through the repair function, stage or
 * play, and keep next-move suggestions fresh.
 */
interface PatternStateBindings {
  playback: Playback
  setCode: (code: string) => void
  setCustomTitle: (title: string | null) => void
  setSourcePrompt: (prompt: string | undefined) => void
}

function usePatternFlow(deps: PatternStateBindings & {
  /** Send the prepared repair message; the fixed pattern, or null on failure. */
  requestFix: (message: string) => Promise<string | null>
  /** A repair replaced `broken` with `fixed`: propagate it into the stored
   * transcript, so future generations and compaction folds see the pattern
   * that actually plays - not the mistake the repair just removed. */
  onPatternFixed: (broken: string, fixed: string) => void
  suggest: (code: string, sourcePrompt?: string) => Promise<TransitionSuggestionsResult>
}) {
  const [uiError, setUiError] = useState<string | null>(null)
  const [stagedCode, setStagedCode] = useState<string | null>(null)
  const [isTransitionPending, setIsTransitionPending] = useState(false)
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
      replace: (fixed) =>
        playbackRef.current.play(fixed, { reportEvaluationError: false }),
    },
    getStopToken: deps.playback.getStopToken,
    onPlaybackSuccess: (code, sourcePrompt) =>
      nextMoves.generate({ code, sourcePrompt }),
  })

  useEffect(() => {
    if (nextMoves.error) setUiError(nextMoves.error)
  }, [nextMoves.error])

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
    if (!isValidatedGeneratedPattern(validated)) {
      setStagedCode(null)
      setUiError(validationFailureMessage(validated))
      return false
    }
    if (mode === 'stage') {
      setStagedCode(validated.code)
      setUiError(null)
      return true
    }

    const outcome = await generatedPattern.attempt(
      validated.code,
      (candidate) =>
        deps.playback.play(candidate, { reportEvaluationError: false }),
    )
    if (outcome.result.ok) {
      setStagedCode(null)
      setUiError(null)
    } else {
      setUiError(generatedPlaybackFailureMessage(outcome.result))
    }
    return true
  }

  const transitionStaged = async (
    durationCycles: number,
    options: StagedTransitionOptions = {},
  ): Promise<void> => {
    const stagedCandidate = stagedCode
    if (!stagedCandidate) return
    if (options.expectedActiveCode !== undefined) {
      const current = playbackRef.current
      if (
        current.playbackState !== 'playing' ||
        current.activeCode !== options.expectedActiveCode
      ) return
    }

    // Consume the one-shot control immediately. Candidate evaluation failures
    // use the remaining repair budget; errors in Purple's generated transition
    // wrapper are kept out of the model conversation.
    setStagedCode(null)
    setUiError(null)
    setIsTransitionPending(true)
    const playingBeforeValidation =
      playbackRef.current.playbackState === 'playing'
        ? playbackRef.current.activeCode
        : null
    try {
      const validated = await generatedPattern.validate(stagedCandidate)
      if (!isValidatedGeneratedPattern(validated)) {
        setUiError(validationFailureMessage(validated))
        return
      }
      if (
        playingBeforeValidation !== null &&
        (playbackRef.current.playbackState !== 'playing' ||
          playbackRef.current.activeCode !== playingBeforeValidation)
      ) return

      let transitionFailed = false
      const outcome = await generatedPattern.attempt(validated.code, async (revision) => {
        const result = await playbackRef.current.transition(revision, durationCycles, {
          reportEvaluationError: false,
        })
        if (isTransitionInfrastructureFailure(result)) {
          transitionFailed = true
          return { ok: false, kind: 'cancelled' }
        }
        return result
      })

      if (outcome.result.ok || (outcome.result.kind === 'cancelled' && !transitionFailed)) return
      if (transitionFailed) {
        setUiError(TRANSITION_ERROR)
      } else {
        setUiError(generatedPlaybackFailureMessage(outcome.result))
      }
    } finally {
      setIsTransitionPending(false)
    }
  }

  return {
    uiError,
    setUiError,
    stagedCode,
    setStagedCode,
    isTransitionPending,
    suggestions: nextMoves.suggestions,
    lastPromptRef,
    acceptPattern,
    transitionStaged,
  }
}

type PatternFlow = ReturnType<typeof usePatternFlow>

export function Composer(props: PatternStateBindings & {
  byokKey: string
  code: string
}) {
  const [input, setInput] = useState('')
  const [initialChat] = useState(
    () => loadByokChat() ?? { messages: [], artifact: null, coveredCount: 0 },
  )
  const [isAcceptingPattern, setIsAcceptingPattern] = useState(false)
  const [explanatoryStyle, setExplanatoryStyle] = useState(false)
  const [chatStorageError, setChatStorageError] = useState<string | null>(null)
  const [showUndo, setShowUndo] = useState(false)
  const patternExplanatoryStyleRef = useRef(false)
  const titleRequestRef = useRef(0)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backend = useMemo(() => createByokBackend(props.byokKey), [props.byokKey])
  const chat = useStudioChat(backend, {
    initialState: initialChat,
    onStateChange: (state) => {
      setChatStorageError(
        saveByokChat(state)
          ? null
          : 'This browser could not save the conversation. Allow site data and try again.',
      )
    },
    onClear: () => {
      setChatStorageError(
        clearByokChat()
          ? null
          : 'The conversation was cleared here, but this browser could not remove its saved copy.',
      )
    },
  })
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => {
    titleRequestRef.current++
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [])

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
        // The caller reports a generic pattern failure after the repair budget ends.
        return null
      }
    },
    onPatternFixed: chat.replaceLastAssistantPattern,
    suggest: backend.suggestTransitions,
  })

  useEffect(() => {
    const stagedCode = flow.stagedCode
    if (!stagedCode) return
    const stagedPatternWasEdited = stagedCode !== props.code
    const stagedPatternIsPlaying =
      props.playback.playbackState === 'playing' &&
      props.playback.activeCode === stagedCode
    if (stagedPatternWasEdited || stagedPatternIsPlaying) flow.setStagedCode(null)
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
  }, [
    chat.messages,
    chat.isStreaming,
    chat.streamingText,
    flow.stagedCode,
    flow.isTransitionPending,
    isAcceptingPattern,
  ])

  const busy =
    chat.isStreaming ||
    isAcceptingPattern ||
    flow.isTransitionPending ||
    props.playback.playbackState === 'transitioning'
  const streamingProse = visibleTextWithoutCodeBlocks(chat.streamingText)

  const hideUndo = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setShowUndo(false)
  }

  const send = (text: string, mode: PatternMode = 'play') => {
    const prompt = text.trim()
    if (!prompt || busy) return
    // A new turn makes the stashed session unrestorable, so retire the offer
    // rather than leave a button that would refuse.
    hideUndo()
    const titleRequest = ++titleRequestRef.current
    // The staged transition belongs to the preceding assistant turn. Once a
    // new turn begins, its one-shot controls are no longer actionable.
    flow.setStagedCode(null)
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
    // Ask for a title in parallel. A request token prevents a slow title from
    // an older turn replacing the title of a newer pattern.
    const titlePromise = backend.generateTitle(prompt)
    void patternPromise
      .then(async (pattern) => {
        if (!pattern) return
        // Keep sends disabled through validation and repair round-trips.
        setIsAcceptingPattern(true)
        const landed = await flow.acceptPattern(pattern, resolvedMode)
        if (landed) {
          void titlePromise.then((title) => {
            if (title.ok && titleRequestRef.current === titleRequest) {
              props.setCustomTitle(title.title)
            }
          })
        }
      })
      .finally(() => {
        setIsAcceptingPattern(false)
      })
  }

  const clearSession = () => {
    const hadConversation = chat.messages.length > 0
    titleRequestRef.current++
    chat.clearChat()
    flow.setUiError(null)
    flow.setStagedCode(null)
    setInput('')
    hideUndo()
    if (!hadConversation) return
    setShowUndo(true)
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null
      setShowUndo(false)
    }, UNDO_CLEAR_WINDOW_MS)
  }

  const undoClearSession = () => {
    hideUndo()
    chat.undoClearChat()
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(input)
    }
  }

  const isEmpty = chat.messages.length === 0
  // Streaming updates often; settled messages only need transforming when
  // the transcript itself changes.
  const transcript = useMemo(
    () =>
      chat.messages.map((message) => ({
        key: message.id,
        role: message.role,
        prose: visibleTextWithoutCodeBlocks(message.content),
      })),
    [chat.messages],
  )
  const sessionError = flow.uiError ?? chat.error ?? chatStorageError

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

      {showUndo ? (
        <div className="undo-strip" role="status">
          <span>Session cleared</span>
          <button className="chrome" onClick={undoClearSession}>UNDO</button>
        </div>
      ) : null}

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
          {flow.stagedCode ? (
            <MixRow flow={flow} playback={props.playback} editorCode={props.code} />
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
          onChange={(event) => {
            hideUndo()
            setInput(event.target.value)
          }}
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

function MixRow(props: {
  flow: PatternFlow
  playback: Playback
  editorCode: string
}) {
  const { flow, playback, editorCode } = props
  const [transitionCycles, setTransitionCycles] = useState(DEFAULT_TRANSITION_CYCLES)
  const [autoXfade, setAutoXfade] = useState<AutoXfadeState>(() =>
    createAutoXfadeState(flow.stagedCode, playback),
  )
  const [remainingSeconds, setRemainingSeconds] = useState(
    AUTO_XFADE_DELAY_MS / 1_000,
  )
  const autoXfadeRef = useRef(autoXfade)
  const flowRef = useRef(flow)
  const playbackRef = useRef(playback)
  const editorCodeRef = useRef(editorCode)
  const transitionCyclesRef = useRef(transitionCycles)
  autoXfadeRef.current = autoXfade
  flowRef.current = flow
  playbackRef.current = playback
  editorCodeRef.current = editorCode
  transitionCyclesRef.current = transitionCycles
  const mixing = playback.playbackState === 'transitioning'

  const cancelAutoXfade = useCallback(() => {
    const current = autoXfadeRef.current
    if (current.kind !== 'armed') return
    const cancelled: AutoXfadeState = {
      kind: 'cancelled',
      stagedCode: current.stagedCode,
    }
    autoXfadeRef.current = cancelled
    setAutoXfade(cancelled)
  }, [])

  const startArmedXfade = useCallback((armed: ArmedAutoXfade) => {
    if (autoXfadeRef.current !== armed) return
    const latestFlow = flowRef.current
    const latestPlayback = playbackRef.current
    if (
      latestFlow.stagedCode !== armed.stagedCode ||
      editorCodeRef.current !== armed.stagedCode ||
      latestPlayback.playbackState !== 'playing' ||
      latestPlayback.activeCode !== armed.activeCode
    ) {
      const cancelled: AutoXfadeState = {
        kind: 'cancelled',
        stagedCode: armed.stagedCode,
      }
      autoXfadeRef.current = cancelled
      setAutoXfade(cancelled)
      return
    }

    const started: AutoXfadeState = {
      kind: 'started',
      stagedCode: armed.stagedCode,
    }
    autoXfadeRef.current = started
    setAutoXfade(started)
    void latestFlow.transitionStaged(transitionCyclesRef.current, {
      expectedActiveCode: armed.activeCode,
    })
  }, [])

  useEffect(() => {
    const stagedCode = flow.stagedCode
    if (!stagedCode || autoXfadeRef.current.stagedCode === stagedCode) return
    const next = createAutoXfadeState(stagedCode, playbackRef.current)
    autoXfadeRef.current = next
    setAutoXfade(next)
    setRemainingSeconds(AUTO_XFADE_DELAY_MS / 1_000)
  }, [flow.stagedCode])

  useEffect(() => {
    const armed = autoXfadeRef.current
    if (
      armed.kind === 'armed' &&
      (flow.stagedCode !== armed.stagedCode ||
        editorCode !== armed.stagedCode ||
        playback.playbackState !== 'playing' ||
        playback.activeCode !== armed.activeCode)
    ) cancelAutoXfade()
  }, [
    cancelAutoXfade,
    editorCode,
    flow.stagedCode,
    playback.activeCode,
    playback.playbackState,
  ])

  useEffect(() => {
    if (autoXfade.kind !== 'armed') return
    const armed = autoXfade
    const updateRemaining = () => {
      setRemainingSeconds(
        Math.max(1, Math.ceil((armed.deadline - Date.now()) / 1_000)),
      )
    }
    updateRemaining()
    const tickId = window.setInterval(updateRemaining, AUTO_XFADE_TICK_MS)
    const timeoutId = window.setTimeout(
      () => startArmedXfade(armed),
      Math.max(0, armed.deadline - Date.now()),
    )
    return () => {
      window.clearInterval(tickId)
      window.clearTimeout(timeoutId)
    }
  }, [autoXfade, startArmedXfade])

  useEffect(() => {
    if (autoXfade.kind !== 'armed') return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelAutoXfade()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cancelAutoXfade()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [autoXfade.kind, cancelAutoXfade])

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
        disabled={mixing || autoXfade.kind === 'started'}
        aria-label={
          autoXfade.kind === 'armed'
            ? 'XFADE NOW; AUTOMATIC XFADE IN 5 SECONDS'
            : undefined
        }
        onClick={() => {
          if (autoXfade.kind === 'armed') {
            startArmedXfade(autoXfade)
            return
          }
          if (autoXfade.kind === 'cancelled') {
            void flow.transitionStaged(transitionCycles)
          }
        }}
      >
        {mixing || autoXfade.kind === 'started' ? (
          'XFADING…'
        ) : autoXfade.kind === 'armed' ? (
          <span aria-hidden="true">XFADE IN {remainingSeconds}s</span>
        ) : (
          'XFADE'
        )}
      </button>
      {autoXfade.kind === 'armed' ? (
        <button
          className="chrome mix-cancel"
          aria-keyshortcuts="Escape"
          onClick={cancelAutoXfade}
        >
          CANCEL / ESC
        </button>
      ) : null}
    </div>
  )
}

interface ArmedAutoXfade {
  kind: 'armed'
  stagedCode: string
  activeCode: string
  deadline: number
}

type AutoXfadeState =
  | ArmedAutoXfade
  | { kind: 'cancelled' | 'started'; stagedCode: string }

function createAutoXfadeState(
  stagedCode: string | null,
  playback: Playback,
): AutoXfadeState {
  const code = stagedCode ?? ''
  if (playback.playbackState !== 'playing' || !playback.activeCode) {
    return { kind: 'cancelled', stagedCode: code }
  }
  return {
    kind: 'armed',
    stagedCode: code,
    activeCode: playback.activeCode,
    deadline: Date.now() + AUTO_XFADE_DELAY_MS,
  }
}
