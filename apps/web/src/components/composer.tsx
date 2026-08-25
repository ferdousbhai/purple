import {
  DEFAULT_PROGRESSION_RUN_DURATION_MS,
  DEFAULT_TRANSITION_CYCLES,
  EXPLANATORY_STYLE_INSTRUCTION,
  PROGRESSION_RUN_DURATION_PRESETS_MS,
  PROMPT_MODIFIERS,
  PROMPT_PRESETS,
  TRANSITION_CYCLE_OPTIONS,
  boundedProgressionRunDurationMs,
  continueProgressionRun,
  generateRandomPrompt,
  progressionStepFromTurn,
  visibleTextWithoutCodeBlocks,
  withExplanatoryStyle,
  type GeneratedTurn,
  type ProgressionStep,
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
export interface GeneratedPatternController {
  play(code: string): Promise<boolean>
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

type ActiveProgressionRunPhase =
  | 'starting'
  | 'waiting'
  | 'generating'
  | 'transitioning'

type ProgressionRunView =
  | { phase: 'idle' }
  | {
      phase: ActiveProgressionRunPhase
      nextAction: string
      afterCycles: number
    }

interface ActiveProgressionRun {
  controller: AbortController
  deadlineTimer?: ReturnType<typeof setTimeout>
}

const IDLE_PROGRESSION_RUN: ProgressionRunView = {
  phase: 'idle',
}

interface StopProgressionRunOptions {
  abortGeneration?: boolean
  clearPlan?: boolean
  notice?: string
}

function cancelActiveProgressionRun(run: ActiveProgressionRun | null): void {
  if (run?.deadlineTimer !== undefined) clearTimeout(run.deadlineTimer)
  run?.controller.abort()
}

function progressionRunDurationLabel(durationMs: number): string {
  const minutes = durationMs / 60_000
  return minutes < 60 ? `${minutes} MIN` : `${minutes / 60} HR`
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

  const playPattern = useCallback(async (pattern: string): Promise<boolean> => {
    if (!generatedPattern.isCurrent(pattern)) {
      return (await playbackRef.current.play(pattern)).ok
    }
    if (playbackRepairRef.current) return false

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
      return outcome.result.ok
    } finally {
      playbackRepairRef.current = false
      setIsPlaybackRepairPending(false)
    }
  }, [generatedPattern.attempt, generatedPattern.isCurrent])

  const transitionPattern = async (
    candidate: string,
    durationCycles: number,
  ): Promise<boolean> => {
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
      const validated = await generatedPattern.validate(candidate)
      if (!isValidatedGeneratedPattern(validated)) {
        setUiError(validationFailureMessage(validated))
        return false
      }
      if (
        playingBeforeValidation !== null &&
        (playbackRef.current.playbackState !== 'playing' ||
          playbackRef.current.activeCode !== playingBeforeValidation)
      ) return false

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

      if (outcome.result.ok) return true
      if (outcome.result.kind === 'cancelled' && !transitionFailed) return false
      if (transitionFailed) {
        setUiError(TRANSITION_ERROR)
      } else {
        setUiError(generatedPlaybackFailureMessage(outcome.result))
      }
      return false
    } finally {
      setIsTransitionPending(false)
    }
  }

  const transitionStaged = async (durationCycles: number): Promise<void> => {
    const candidate = stagedCode
    if (candidate) await transitionPattern(candidate, durationCycles)
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
    transitionPattern,
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
  const [progressionStep, setProgressionStepState] =
    useState<ProgressionStep | null>(null)
  const progressionStepRef = useRef<ProgressionStep | null>(null)
  const [progressionRun, setProgressionRunState] =
    useState<ProgressionRunView>(IDLE_PROGRESSION_RUN)
  const [progressionRunDurationMs, setProgressionRunDurationMs] = useState(
    DEFAULT_PROGRESSION_RUN_DURATION_MS,
  )
  const [progressionRunNotice, setProgressionRunNotice] =
    useState<string | null>(null)
  const progressionRunViewRef = useRef<ProgressionRunView>(IDLE_PROGRESSION_RUN)
  const activeProgressionRunRef = useRef<ActiveProgressionRun | null>(null)
  const patternExplanatoryStyleRef = useRef(false)
  const turnRequestRef = useRef(0)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backend = useMemo(() => createByokBackend(props.byokKey), [props.byokKey])
  const setProgressionStep = useCallback((step: ProgressionStep | null) => {
    progressionStepRef.current = step
    setProgressionStepState(step)
  }, [])
  const setProgressionRun = useCallback((view: ProgressionRunView) => {
    progressionRunViewRef.current = view
    setProgressionRunState(view)
  }, [])
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
    onPatternFixed: (broken, fixed) => {
      chat.replaceLastAssistantPattern(broken, fixed)
      const step = progressionStepRef.current
      if (step?.pattern === broken) {
        setProgressionStep({ ...step, pattern: fixed })
      }
    },
  })

  const stopProgressionRun = useCallback((
    options: StopProgressionRunOptions = {},
  ): void => {
    const activeRun = activeProgressionRunRef.current
    cancelActiveProgressionRun(activeRun)
    activeProgressionRunRef.current = null
    if (
      options.abortGeneration &&
      progressionRunViewRef.current.phase === 'generating'
    ) {
      chat.abortStream()
    }
    setProgressionRun(IDLE_PROGRESSION_RUN)
    setProgressionRunNotice(options.notice ?? null)
    if (options.clearPlan) setProgressionStep(null)
  }, [chat.abortStream, setProgressionRun, setProgressionStep])

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
    const activeRun = activeProgressionRunRef.current
    cancelActiveProgressionRun(activeRun)
    activeProgressionRunRef.current = null
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
    progressionRun.phase,
  ])

  const busy =
    chat.isStreaming ||
    isAcceptingPattern ||
    flow.isPlaybackRepairPending ||
    flow.isTransitionPending ||
    props.playback.playbackState === 'loading' ||
    props.playback.playbackState === 'transitioning'

  useEffect(() => {
    if (
      isAcceptingPattern ||
      progressionRunViewRef.current.phase === 'generating' ||
      progressionRunViewRef.current.phase === 'transitioning'
    ) return
    const step = progressionStepRef.current
    if (step && step.pattern !== props.code) {
      stopProgressionRun({ clearPlan: true })
    }
  }, [isAcceptingPattern, props.code, stopProgressionRun])

  useEffect(() => {
    if (
      activeProgressionRunRef.current === null ||
      progressionRunViewRef.current.phase === 'starting'
    ) {
      return
    }
    if (
      props.playback.playbackState === 'stopped' ||
      props.playback.playbackState === 'error'
    ) {
      stopProgressionRun()
    }
  }, [props.playback.playbackState, stopProgressionRun])

  const hideUndo = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setShowUndo(false)
  }

  const generateTurn = (
    text: string,
    options: { clearInput?: boolean } = {},
  ): Promise<GeneratedTurn | null> => {
    const prompt = text.trim()
    if (!prompt || busy) return Promise.resolve(null)
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
    if (options.clearInput) setInput('')
    return turnPromise
      .then(async (turn) => {
        if (!turn || turnRequestRef.current !== turnRequest) return null
        const preparation =
          preparedPattern ?? beginPatternPreparation(turn.pattern)
        const prepared = await preparation
        finishPatternPreparation()
        if (!prepared.valid || turnRequestRef.current !== turnRequest) return null
        if (!flow.isCurrent(turn.pattern)) return null

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
        return turn
      })
      .finally(() => {
        setIsAcceptingPattern(false)
        finishPatternPreparation()
        if (turnRequestRef.current === turnRequest) {
          props.setPatternProvisional(false)
        }
      })
  }

  const send = (text: string) => {
    const prompt = text.trim()
    if (!prompt || busy) return
    stopProgressionRun({ clearPlan: true })
    void generateTurn(prompt, { clearInput: true }).then((turn) => {
      if (turn) setProgressionStep(progressionStepFromTurn(turn))
    })
  }

  const startProgressionRun = (): void => {
    const initialStep = progressionStepRef.current
    if (!initialStep || busy || activeProgressionRunRef.current) return

    const durationMs = boundedProgressionRunDurationMs(
      progressionRunDurationMs,
    )
    const activeRun: ActiveProgressionRun = {
      controller: new AbortController(),
    }
    activeProgressionRunRef.current = activeRun
    activeRun.deadlineTimer = setTimeout(() => {
      if (activeProgressionRunRef.current !== activeRun) return
      stopProgressionRun({
        abortGeneration: true,
        notice: `${progressionRunDurationLabel(durationMs)} COMPLETE`,
      })
    }, durationMs)
    setProgressionRunNotice(null)
    const isCurrent = () =>
      activeProgressionRunRef.current === activeRun &&
      !activeRun.controller.signal.aborted
    const showPhase = (
      phase: ActiveProgressionRunPhase,
      step: ProgressionStep,
    ) => {
      if (!isCurrent()) return
      setProgressionRun({
        phase,
        nextAction: step.nextAction,
        afterCycles: step.afterCycles,
      })
    }

    showPhase('starting', initialStep)
    flow.setStagedCode(null)
    void (async () => {
      const alreadyPlaying =
        props.playback.playbackState === 'playing' &&
        props.playback.activeCode === initialStep.pattern
      const started = alreadyPlaying
        ? true
        : props.playback.playbackState === 'playing'
          ? await flow.transitionPattern(
              initialStep.pattern,
              DEFAULT_TRANSITION_CYCLES,
            )
          : await flow.playPattern(initialStep.pattern)
      if (!isCurrent()) return
      if (!started) {
        stopProgressionRun()
        return
      }

      await continueProgressionRun(initialStep, {
        isCurrent,
        wait: async (step) => {
          showPhase('waiting', step)
          const result = await props.playback.waitForCycles(
            step.afterCycles,
            activeRun.controller.signal,
          )
          if (!result.ok && result.kind !== 'cancelled' && isCurrent()) {
            flow.setUiError(result.error)
          }
          return result.ok
        },
        generate: async (step) => {
          showPhase('generating', step)
          return generateTurn(step.nextAction)
        },
        transition: async (turn) => {
          setProgressionStep(progressionStepFromTurn(turn))
          showPhase('transitioning', {
            pattern: turn.pattern,
            afterCycles: turn.progression?.afterCycles ?? initialStep.afterCycles,
            nextAction: turn.progression?.nextAction ?? initialStep.nextAction,
          })
          return flow.transitionPattern(
            turn.pattern,
            DEFAULT_TRANSITION_CYCLES,
          )
        },
      })

      if (!isCurrent()) return
      stopProgressionRun()
    })()
  }

  const clearSession = () => {
    const hadConversation = chat.messages.length > 0
    stopProgressionRun({ clearPlan: true })
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

      {progressionStep || progressionRun.phase !== 'idle' ? (
        <ProgressionRow
          busy={busy}
          durationMs={progressionRunDurationMs}
          notice={progressionRunNotice}
          run={progressionRun}
          step={progressionStep}
          onDurationChange={(durationMs) => {
            setProgressionRunDurationMs(
              boundedProgressionRunDurationMs(durationMs),
            )
            setProgressionRunNotice(null)
          }}
          onStart={startProgressionRun}
          onStop={() => stopProgressionRun({ abortGeneration: true })}
        />
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

function ProgressionRow(props: {
  busy: boolean
  durationMs: number
  notice: string | null
  run: ProgressionRunView
  step: ProgressionStep | null
  onDurationChange(durationMs: number): void
  onStart(): void
  onStop(): void
}) {
  const running = props.run.phase !== 'idle'
  const afterCycles = props.run.phase === 'idle'
    ? props.step?.afterCycles
    : props.run.afterCycles
  const action = props.run.phase === 'idle'
    ? props.step?.nextAction
    : props.run.nextAction
  const status = progressionRunStatus(props.run, afterCycles, props.notice)

  return (
    <div className="progression-row" aria-live="polite">
      <span className="chip-label">RUN</span>
      <span className="progression-copy" title={action ?? undefined}>
        <strong>{status}</strong>
        <span>{action}</span>
      </span>
      <select
        aria-label="Run duration"
        className="run-duration"
        disabled={running || props.busy}
        value={props.durationMs}
        onChange={(event) => props.onDurationChange(Number(event.target.value))}
      >
        {PROGRESSION_RUN_DURATION_PRESETS_MS.map((durationMs) => (
          <option key={durationMs} value={durationMs}>
            {progressionRunDurationLabel(durationMs)}
          </option>
        ))}
      </select>
      <button
        className={`primary ${running ? 'stop' : ''}`}
        disabled={!running && props.busy}
        onClick={running ? props.onStop : props.onStart}
      >
        {running ? 'STOP RUN' : 'START RUN'}
      </button>
    </div>
  )
}

function progressionRunStatus(
  run: ProgressionRunView,
  afterCycles: number | undefined,
  notice: string | null,
): string {
  switch (run.phase) {
    case 'idle':
      return notice ?? `${afterCycles ?? ''} CYCLES`
    case 'starting':
      return 'STARTING'
    case 'waiting':
      return `PLAYING ${run.afterCycles} CYCLES`
    case 'generating':
      return 'GENERATING NEXT'
    case 'transitioning':
      return 'XFADING'
  }
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
