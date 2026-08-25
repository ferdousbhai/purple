import {
  DEFAULT_TRANSITION_CYCLES,
  EXPLANATORY_STYLE_INSTRUCTION,
  PROMPT_MODIFIERS,
  PROMPT_PRESETS,
  TRANSITION_CYCLE_OPTIONS,
  generateRandomPrompt,
  visibleTextWithoutCodeBlocks,
  withExplanatoryStyle,
  type TransitionSuggestion,
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
  TRANSITION_ERROR,
  validationFailureMessage,
} from '@purple/ui/playback-flow'
import { useGeneratedPattern } from '@purple/ui/use-generated-pattern'
import type { usePlayback } from '@purple/ui/use-playback'
import { useStudioChat } from '@purple/ui/use-studio-chat'

const UNDO_CLEAR_WINDOW_MS = 10_000
type Playback = ReturnType<typeof usePlayback>
export type GeneratedPatternPlayer = (code: string) => Promise<void>
export interface GeneratedPatternController {
  play: GeneratedPatternPlayer
  invalidate(): void
}

/**
 * Pattern acceptance: validate and repair generated code, stage revisions,
 * and keep next-move suggestions fresh.
 */
interface PatternStateBindings {
  playback: Playback
  setCode: (code: string) => void
  setSourcePrompt: (prompt: string | undefined) => void
}

interface PreparedPattern {
  code: string
  valid: boolean
}

function usePatternFlow(deps: PatternStateBindings & {
  abortRepair: () => void
  /** Send the prepared repair message; the fixed pattern, or null on failure. */
  requestFix: (message: string) => Promise<string | null>
  /** A repair replaced `broken` with `fixed`: propagate it into the stored
   * transcript, so future generations and compaction folds see the pattern
   * that actually plays - not the mistake the repair just removed. */
  onPatternFixed: (broken: string, fixed: string) => void
}) {
  const [uiError, setUiError] = useState<string | null>(null)
  const [stagedCode, setStagedCode] = useState<string | null>(null)
  const [isTransitionPending, setIsTransitionPending] = useState(false)
  const [isPlaybackRepairPending, setIsPlaybackRepairPending] = useState(false)
  const [suggestions, setSuggestions] = useState<TransitionSuggestion[]>([])
  const playbackRepairRef = useRef(false)
  const lastPromptRef = useRef('')
  const playbackRef = useRef(deps.playback)
  playbackRef.current = deps.playback
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
    onInvalidate: deps.abortRepair,
  })

  /** Adopt and validate as soon as the leading structured field is complete. */
  const preparePattern = async (pattern: string): Promise<PreparedPattern> => {
    const sourcePrompt = lastPromptRef.current
    generatedPattern.adopt(pattern)
    deps.setSourcePrompt(sourcePrompt)

    // Audit the pattern against the live engine before it plays or stages:
    // evaluation failures, empty patterns, and sound names that would play
    // silence go back to Gemini as hidden messages. Sends are disabled while
    // a generation (validation repairs included) is in flight.
    const validated = await generatedPattern.validate(pattern)
    if (!isValidatedGeneratedPattern(validated)) {
      setStagedCode(null)
      setUiError(validationFailureMessage(validated))
      return { code: validated.code, valid: false }
    }
    setUiError(null)
    return { code: validated.code, valid: true }
  }

  /** Land validated code without starting audio; revisions can be crossfaded. */
  const landPattern = (pattern: string): void => {
    setStagedCode(
      playbackRef.current.playbackState === 'playing' ? pattern : null,
    )
    setUiError(null)
  }

  const showSuggestions = (
    nextSuggestions: TransitionSuggestion[],
  ): void => {
    setSuggestions(nextSuggestions)
  }

  const playPattern = useCallback(async (pattern: string): Promise<void> => {
    if (!generatedPattern.isCurrent(pattern)) {
      await playbackRef.current.play(pattern)
      return
    }
    if (playbackRepairRef.current) return

    playbackRepairRef.current = true
    setIsPlaybackRepairPending(true)
    try {
      const outcome = await generatedPattern.attempt(
        pattern,
        (candidate) =>
          playbackRef.current.play(candidate, { reportEvaluationError: false }),
      )
      setUiError(
        outcome.result.ok
          ? null
          : generatedPlaybackFailureMessage(outcome.result),
      )
    } finally {
      playbackRepairRef.current = false
      setIsPlaybackRepairPending(false)
    }
  }, [generatedPattern.attempt, generatedPattern.isCurrent])

  const transitionStaged = async (durationCycles: number): Promise<void> => {
    const stagedCandidate = stagedCode
    if (!stagedCandidate) return

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
    isPlaybackRepairPending,
    suggestions,
    lastPromptRef,
    preparePattern,
    landPattern,
    showSuggestions,
    playPattern,
    invalidate: generatedPattern.invalidate,
    isCurrent: generatedPattern.isCurrent,
    transitionStaged,
  }
}

type PatternFlow = ReturnType<typeof usePatternFlow>

export function Composer(props: PatternStateBindings & {
  byokKey: string
  code: string
  customTitle: string | null
  sourcePrompt: string | undefined
  setCustomTitle: (title: string | null) => void
  setPatternPreview: (code: string | null) => void
  setPatternPending: (pending: boolean) => void
  setPatternProvisional: (provisional: boolean) => void
  getCodeRevision: () => number
  getTitleRevision: () => number
  registerGeneratedPatternController: (
    controller: GeneratedPatternController | null,
  ) => void
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
  const turnRequestRef = useRef(0)
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

  const flow = usePatternFlow({
    playback: props.playback,
    abortRepair: backend.abortRepair,
    setCode: props.setCode,
    setSourcePrompt: props.setSourcePrompt,
    requestFix: async (message) => {
      try {
        return await backend.repairPattern(
          withExplanatoryStyle(
            message,
            patternExplanatoryStyleRef.current,
          ),
        )
      } catch {
        // The caller reports a generic pattern failure after the repair budget ends.
        return null
      }
    },
    onPatternFixed: chat.replaceLastAssistantPattern,
  })

  useEffect(() => {
    props.registerGeneratedPatternController({
      play: flow.playPattern,
      invalidate: flow.invalidate,
    })
    return () => {
      flow.invalidate()
      props.registerGeneratedPatternController(null)
    }
  }, [
    flow.invalidate,
    flow.playPattern,
    props.registerGeneratedPatternController,
  ])

  useEffect(() => () => {
    turnRequestRef.current++
    props.setPatternPending(false)
    props.setPatternProvisional(false)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [props.setPatternPending, props.setPatternProvisional])

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
    flow.stagedCode,
    flow.isTransitionPending,
    isAcceptingPattern,
  ])

  const busy =
    chat.isStreaming ||
    isAcceptingPattern ||
    flow.isPlaybackRepairPending ||
    flow.isTransitionPending ||
    props.playback.playbackState === 'transitioning'

  const hideUndo = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setShowUndo(false)
  }

  const send = (text: string) => {
    const prompt = text.trim()
    if (!prompt || busy) return
    // A new turn makes the stashed session unrestorable, so retire the offer
    // rather than leave a button that would refuse.
    hideUndo()
    const turnRequest = ++turnRequestRef.current
    const codeRevision = props.getCodeRevision()
    const titleRevision = props.getTitleRevision()
    const previousPattern = {
      code: props.code,
      customTitle: props.customTitle,
      sourcePrompt: props.sourcePrompt,
    }
    // The staged transition belongs to the preceding assistant turn. Once a
    // new turn begins, its one-shot controls are no longer actionable.
    flow.setStagedCode(null)
    flow.lastPromptRef.current = prompt
    patternExplanatoryStyleRef.current = explanatoryStyle
    flow.setUiError(null)
    let preparedPattern: Promise<PreparedPattern> | null = null
    let patternAdopted = false
    let patternRestored = false
    const finishPatternPreparation = () => {
      if (turnRequestRef.current === turnRequest) {
        props.setPatternPending(false)
      }
    }
    const restorePreviousPattern = () => {
      if (!patternAdopted || patternRestored) return
      patternRestored = true
      if (props.getCodeRevision() !== codeRevision) return
      flow.invalidate()
      props.setCode(previousPattern.code)
      props.setSourcePrompt(previousPattern.sourcePrompt)
      if (props.getTitleRevision() === titleRevision) {
        props.setCustomTitle(previousPattern.customTitle)
      }
    }
    const beginPatternPreparation = (pattern: string) => {
      patternAdopted = true
      if (props.getTitleRevision() === titleRevision) {
        props.setCustomTitle(null)
      }
      const preparation = flow.preparePattern(pattern)
      preparedPattern = preparation
      void preparation.then(
        finishPatternPreparation,
        finishPatternPreparation,
      )
      return preparation
    }
    setIsAcceptingPattern(true)
    props.setPatternPending(true)
    props.setPatternProvisional(true)
    void props.playback.prepareValidation()
    const turnPromise = chat.sendMessage(prompt, {
      requestInstruction: explanatoryStyle
        ? EXPLANATORY_STYLE_INSTRUCTION
        : undefined,
      onPatternPreview: props.setPatternPreview,
      onPatternPreviewDiscarded: () => {
        props.setPatternPreview(null)
        restorePreviousPattern()
        finishPatternPreparation()
        if (turnRequestRef.current === turnRequest) {
          props.setPatternProvisional(false)
        }
      },
      resolvePattern: (pattern) => {
        props.setPatternPreview(null)
        return beginPatternPreparation(pattern).then((prepared) => prepared.code)
      },
    })
    setInput('')
    void turnPromise
      .then(async (turn) => {
        if (!turn || turnRequestRef.current !== turnRequest) return
        const preparation =
          preparedPattern ?? beginPatternPreparation(turn.pattern)
        const prepared = await preparation
        finishPatternPreparation()
        if (!prepared.valid || turnRequestRef.current !== turnRequest) return
        if (!flow.isCurrent(turn.pattern)) return

        // Metadata belongs to the original turn. Pattern repairs carry its
        // suggestions and title forward with the corrected code.
        flow.showSuggestions(turn.suggestions)
        flow.landPattern(turn.pattern)
        if (
          turn.title &&
          turnRequestRef.current === turnRequest &&
          props.getTitleRevision() === titleRevision
        ) {
          props.setCustomTitle(turn.title)
        }
      })
      .finally(() => {
        setIsAcceptingPattern(false)
        finishPatternPreparation()
        if (turnRequestRef.current === turnRequest) {
          props.setPatternProvisional(false)
        }
      })
  }

  const clearSession = () => {
    const hadConversation = chat.messages.length > 0
    turnRequestRef.current++
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
  // Settled messages only need transforming when the transcript changes.
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
          {busy ? (
            <span className="stream-dots" aria-label="Generating">
              <span>.</span><span>.</span><span>.</span>
            </span>
          ) : null}
          {flow.stagedCode ? (
            <MixRow flow={flow} playback={props.playback} />
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
              onClick={() => send(suggestion.prompt)}
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
}) {
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
        onClick={() => void flow.transitionStaged(transitionCycles)}
      >
        {mixing ? 'XFADING…' : 'XFADE'}
      </button>
    </div>
  )
}
