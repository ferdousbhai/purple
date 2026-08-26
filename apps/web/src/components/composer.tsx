import {
  DEFAULT_AUTOPLAY_TRANSITION_CYCLES,
  DEFAULT_MANUAL_TRANSITION_CYCLES,
  DEFAULT_PROGRESSION_RUN_DURATION_MS,
  EXPLANATORY_STYLE_INSTRUCTION,
  PROGRESSION_RUN_DURATION_PRESETS_MS,
  PROMPT_MODIFIERS,
  PROMPT_PRESETS,
  TRANSITION_CYCLE_OPTIONS,
  boundedProgressionRunDurationMs,
  continueProgressionRun,
  generateRandomPrompt,
  progressionStepFromTurn,
  visibleGeneratedTurnExplanation,
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
const MANUAL_XFADE_DELAY_MS = 5_000
type Playback = ReturnType<typeof usePlayback>
export interface GeneratedPatternController {
  play(code: string): Promise<boolean>
  invalidate(): void
}

export type RevisionPhase = 'idle' | 'revising' | 'checking'

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

interface TransitionPatternOptions {
  expectedStopToken?: number
  validateCandidate?: boolean
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
      remainingCycles?: number
      remainingSeconds?: number
    }

interface ActiveProgressionRun {
  controller: AbortController
  deadlineTimer?: ReturnType<typeof setTimeout>
  skipWait?: () => void
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
  if (run) run.skipWait = undefined
  run?.controller.abort()
}

function progressionCountdownLabel(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.ceil(seconds))
  const totalMinutes = Math.floor(wholeSeconds / 60)
  const clock = `${String(totalMinutes % 60).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`
  return totalMinutes < 60
    ? `${totalMinutes}:${String(wholeSeconds % 60).padStart(2, '0')}`
    : `${Math.floor(totalMinutes / 60)}:${clock}`
}

function progressionRunDurationLabel(durationMs: number): string {
  const minutes = durationMs / 60_000
  return minutes < 60 ? `${minutes} MIN` : `${minutes / 60} HR`
}

function usePatternFlow(deps: PatternStateBindings & {
  abortRepair: () => void
  setRevisionStaged: (staged: boolean) => void
  /** Send the prepared repair message; the fixed pattern, or null on failure. */
  requestFix: (message: string) => Promise<string | null>
  /** A repair replaced `broken` with `fixed`: propagate it into the stored
   * transcript, so future generations and compaction folds see the pattern
   * that actually plays - not the mistake the repair just removed. */
  onPatternFixed: (broken: string, fixed: string) => void
}) {
  const [uiError, setUiError] = useState<string | null>(null)
  const [stagedCode, setStagedCode] = useState<string | null>(null)
  const [stagedTransitionScheduled, setStagedTransitionScheduled] =
    useState(false)
  const [isTransitionPending, setIsTransitionPending] = useState(false)
  const [isPlaybackRepairPending, setIsPlaybackRepairPending] = useState(false)
  const [suggestions, setSuggestions] = useState<TransitionSuggestion[]>([])
  const playbackRepairRef = useRef(false)
  const transitionInFlightRef = useRef(false)
  const stagedStopTokenRef = useRef<number | null>(null)
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
    generatedPattern.adopt(pattern, { commit: false })

    // Audit the pattern against the live engine before it plays or stages:
    // evaluation failures, empty patterns, and sound names that would play
    // silence go back to Gemini as hidden messages. Sends are disabled while
    // a generation (validation repairs included) is in flight.
    const validated = await generatedPattern.validate(pattern)
    if (!generatedPattern.isValidationCurrent(validated)) {
      return { code: validated.code, valid: false }
    }
    if (!isValidatedGeneratedPattern(validated)) {
      setStagedCode(null)
      setUiError(validationFailureMessage(validated))
      return { code: validated.code, valid: false }
    }
    if (!generatedPattern.commitCurrent(validated)) {
      return { code: validated.code, valid: false }
    }
    deps.setSourcePrompt(sourcePrompt)
    setUiError(null)
    return { code: validated.code, valid: true }
  }

  /** Land validated code without starting audio; revisions can be crossfaded. */
  const landPattern = (
    pattern: string,
    scheduleTransition: boolean,
  ): void => {
    const staged = playbackRef.current.playbackState === 'playing'
      ? pattern
      : null
    setStagedCode(staged)
    deps.setRevisionStaged(staged !== null)
    stagedStopTokenRef.current = staged === null
      ? null
      : playbackRef.current.getStopToken()
    setStagedTransitionScheduled(staged !== null && scheduleTransition)
    setUiError(null)
  }

  const updateStagedCode = useCallback((code: string | null): void => {
    setStagedCode(code)
    deps.setRevisionStaged(code !== null)
    if (code === null) {
      stagedStopTokenRef.current = null
      setStagedTransitionScheduled(false)
    }
  }, [deps.setRevisionStaged])

  const cancelStagedTransition = useCallback((): void => {
    setStagedTransitionScheduled(false)
  }, [])

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
      if (!generatedPattern.isAttemptCurrent(outcome)) return false
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
  }, [
    generatedPattern.attempt,
    generatedPattern.isAttemptCurrent,
    generatedPattern.isCurrent,
  ])

  const transitionPattern = async (
    candidate: string,
    durationCycles: number,
    options: TransitionPatternOptions = {},
  ): Promise<boolean> => {
    if (transitionInFlightRef.current) return false
    transitionInFlightRef.current = true
    // Candidate evaluation failures use the remaining repair budget; errors in
    // Purple's generated transition wrapper stay out of model conversation.
    setStagedTransitionScheduled(false)
    setUiError(null)
    setIsTransitionPending(true)
    try {
      const playback = playbackRef.current
      const playingBeforeValidation = playback.playbackState === 'playing'
        ? playback.activeCode
        : null
      if (
        playingBeforeValidation === null ||
        (options.expectedStopToken !== undefined &&
          playback.getStopToken() !== options.expectedStopToken)
      ) {
        return false
      }

      let validatedCode = candidate
      if (options.validateCandidate !== false) {
        const validated = await generatedPattern.validate(candidate)
        if (!generatedPattern.isValidationCurrent(validated)) return false
        if (!isValidatedGeneratedPattern(validated)) {
          setUiError(validationFailureMessage(validated))
          return false
        }
        validatedCode = validated.code
      }
      if (
        playbackRef.current.playbackState !== 'playing' ||
        playbackRef.current.activeCode !== playingBeforeValidation ||
        (options.expectedStopToken !== undefined &&
          playbackRef.current.getStopToken() !== options.expectedStopToken)
      ) return false

      let transitionFailed = false
      const outcome = await generatedPattern.attempt(validatedCode, async (revision) => {
        const result = await playbackRef.current.transition(revision, durationCycles, {
          reportEvaluationError: false,
        })
        if (isTransitionInfrastructureFailure(result)) {
          transitionFailed = true
          return { ok: false, kind: 'cancelled' }
        }
        return result
      })
      if (!generatedPattern.isAttemptCurrent(outcome)) return false

      if (outcome.result.ok) {
        updateStagedCode(null)
        return true
      }
      if (outcome.result.kind === 'cancelled' && !transitionFailed) return false
      if (transitionFailed) {
        setUiError(TRANSITION_ERROR)
      } else {
        setUiError(generatedPlaybackFailureMessage(outcome.result))
      }
      if (playbackRef.current.playbackState === 'playing') {
        updateStagedCode(outcome.code)
        stagedStopTokenRef.current = playbackRef.current.getStopToken()
      }
      return false
    } finally {
      transitionInFlightRef.current = false
      setIsTransitionPending(false)
    }
  }

  const transitionStaged = async (durationCycles: number): Promise<void> => {
    const candidate = stagedCode
    const expectedStopToken = stagedStopTokenRef.current
    if (candidate && expectedStopToken !== null) {
      await transitionPattern(candidate, durationCycles, {
        expectedStopToken,
        validateCandidate: false,
      })
    }
  }

  return {
    uiError,
    setUiError,
    stagedCode,
    setStagedCode: updateStagedCode,
    stagedTransitionScheduled,
    cancelStagedTransition,
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
  shareId: string | null
  restorePersistedChat?: boolean
  sourcePrompt: string | undefined
  setCustomTitle: (title: string | null) => void
  setShareId: (shareId: string | null) => void
  setRevisionPhase: (phase: RevisionPhase) => void
  setRevisionStaged: (staged: boolean) => void
  setPatternProvisional: (provisional: boolean) => void
  getCodeRevision: () => number
  getTitleRevision: () => number
  registerGeneratedPatternController: (
    controller: GeneratedPatternController | null,
  ) => void
}) {
  const [input, setInput] = useState('')
  const [initialChat] = useState(
    () => props.restorePersistedChat === false
      ? { messages: [], artifact: null, coveredCount: 0 }
      : loadByokChat() ?? { messages: [], artifact: null, coveredCount: 0 },
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
  const [queuedRunPrompt, setQueuedRunPromptState] = useState<string | null>(null)
  const queuedRunPromptRef = useRef<string | null>(null)
  const patternExplanatoryStyleRef = useRef(false)
  const currentPatternRef = useRef({
    code: props.code,
    customTitle: props.customTitle,
    shareId: props.shareId,
    sourcePrompt: props.sourcePrompt,
  })
  currentPatternRef.current = {
    code: props.code,
    customTitle: props.customTitle,
    shareId: props.shareId,
    sourcePrompt: props.sourcePrompt,
  }
  const turnRequestRef = useRef(0)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoSessionUiRef = useRef<{
    progressionStep: ProgressionStep | null
    suggestions: TransitionSuggestion[]
  } | null>(null)
  const backend = useMemo(() => createByokBackend(props.byokKey), [props.byokKey])
  const setProgressionStep = useCallback((step: ProgressionStep | null) => {
    progressionStepRef.current = step
    setProgressionStepState(step)
  }, [])
  const setProgressionRun = useCallback((view: ProgressionRunView) => {
    progressionRunViewRef.current = view
    setProgressionRunState(view)
  }, [])
  const setQueuedRunPrompt = useCallback((prompt: string | null) => {
    queuedRunPromptRef.current = prompt
    setQueuedRunPromptState(prompt)
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
    setRevisionStaged: props.setRevisionStaged,
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
      chat.abortStream(true)
    }
    setProgressionRun(IDLE_PROGRESSION_RUN)
    setQueuedRunPrompt(null)
    setProgressionRunNotice(options.notice ?? null)
    if (options.clearPlan) setProgressionStep(null)
  }, [chat.abortStream, setProgressionRun, setProgressionStep, setQueuedRunPrompt])

  useEffect(() => {
    props.registerGeneratedPatternController({
      play: flow.playPattern,
      invalidate: () => {
        flow.invalidate()
        chat.abortStream()
      },
    })
    return () => {
      flow.invalidate()
      props.registerGeneratedPatternController(null)
    }
  }, [
    flow.invalidate,
    flow.playPattern,
    chat.abortStream,
    props.registerGeneratedPatternController,
  ])

  useEffect(() => () => props.setRevisionStaged(false), [props.setRevisionStaged])

  useEffect(() => () => {
    const activeRun = activeProgressionRunRef.current
    cancelActiveProgressionRun(activeRun)
    activeProgressionRunRef.current = null
    turnRequestRef.current++
    props.setRevisionPhase('idle')
    props.setPatternProvisional(false)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [props.setPatternProvisional, props.setRevisionPhase])

  useEffect(() => {
    const stagedCode = flow.stagedCode
    if (!stagedCode) return
    const stagedPatternWasEdited = stagedCode !== props.code
    const stagedPatternIsPlaying =
      props.playback.playbackState === 'playing' &&
      props.playback.activeCode === stagedCode
    const playbackEnded =
      props.playback.playbackState === 'stopped' ||
      props.playback.playbackState === 'error'
    if (stagedPatternWasEdited || stagedPatternIsPlaying || playbackEnded) {
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
  const generating = chat.isStreaming || isAcceptingPattern

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
      stopProgressionRun({ abortGeneration: true })
    }
  }, [props.playback.playbackState, stopProgressionRun])

  const hideUndo = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    undoSessionUiRef.current = null
    setShowUndo(false)
  }

  const generateTurn = (
    text: string,
    options: {
      clearInput?: boolean
      scheduleTransition?: boolean
    } = {},
  ): Promise<GeneratedTurn | null> => {
    const prompt = text.trim()
    if (!prompt || busy) return Promise.resolve(null)
    // A new turn makes the stashed session unrestorable, so retire the offer
    // rather than leave a button that would refuse.
    hideUndo()
    const turnRequest = ++turnRequestRef.current
    const codeRevision = props.getCodeRevision()
    const titleRevision = props.getTitleRevision()
    const previousPattern = { ...currentPatternRef.current }
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
        props.setRevisionPhase('idle')
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
        props.setShareId(previousPattern.shareId)
      }
    }
    const beginPatternPreparation = (pattern: string) => {
      patternAdopted = true
      if (turnRequestRef.current === turnRequest) {
        props.setRevisionPhase('checking')
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
    props.setRevisionPhase('revising')
    props.setPatternProvisional(true)
    void props.playback.prepareValidation()
    const turnPromise = chat.sendMessage(prompt, {
      currentPattern: previousPattern.code,
      requestInstruction: explanatoryStyle
        ? EXPLANATORY_STYLE_INSTRUCTION
        : undefined,
      onPatternPreviewDiscarded: () => {
        restorePreviousPattern()
        finishPatternPreparation()
        if (turnRequestRef.current === turnRequest) {
          props.setPatternProvisional(false)
        }
      },
      resolvePattern: (pattern) => {
        return beginPatternPreparation(pattern).then((prepared) =>
          prepared.valid ? prepared.code : null,
        )
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
        flow.landPattern(turn.pattern, options.scheduleTransition !== false)
        if (
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

  const steerRun = (text: string) => {
    const prompt = text.trim()
    if (!prompt || busy || activeProgressionRunRef.current === null) return
    setQueuedRunPrompt(prompt)
    const current = progressionRunViewRef.current
    if (current.phase === 'starting' || current.phase === 'waiting') {
      setProgressionRun({ ...current, nextAction: prompt })
    }
    setInput('')
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
    setQueuedRunPrompt(null)
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
    const showWaitCountdown = (
      remainingCycles: number,
      cyclesPerSecond: number,
    ) => {
      if (!isCurrent() || !Number.isFinite(cyclesPerSecond) || cyclesPerSecond <= 0) {
        return
      }
      const current = progressionRunViewRef.current
      if (current.phase !== 'waiting') return
      const remainingSeconds = Math.max(
        0,
        Math.ceil(remainingCycles / cyclesPerSecond),
      )
      if (current.remainingSeconds === remainingSeconds) return
      // The meter reads the same cycle sample the countdown does, so the fill
      // and the clock never disagree about how much of the hold is left.
      setProgressionRun({ ...current, remainingCycles, remainingSeconds })
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
              DEFAULT_AUTOPLAY_TRANSITION_CYCLES,
              { validateCandidate: false },
            )
          : await flow.playPattern(initialStep.pattern)
      if (!isCurrent()) return
      if (!started) {
        stopProgressionRun()
        return
      }

      await continueProgressionRun(initialStep, {
        isCurrent,
        wait: (step) => {
          showPhase('waiting', {
            ...step,
            nextAction: queuedRunPromptRef.current ?? step.nextAction,
          })
          const waitController = new AbortController()
          const abortWait = () => waitController.abort()
          activeRun.controller.signal.addEventListener('abort', abortWait, { once: true })
          let skipWait = (): void => {}
          const skipped = new Promise<boolean>((resolve) => {
            skipWait = () => {
              resolve(true)
              waitController.abort()
            }
            activeRun.skipWait = skipWait
          })
          const musicalWait = props.playback.waitForCycles(
            step.afterCycles,
            waitController.signal,
            showWaitCountdown,
          ).then((result) => {
            if (!result.ok && result.kind !== 'cancelled' && isCurrent()) {
              flow.setUiError(result.error)
            }
            return result.ok
          })
          return Promise.race([musicalWait, skipped]).finally(() => {
            activeRun.controller.signal.removeEventListener('abort', abortWait)
            if (activeRun.skipWait === skipWait) activeRun.skipWait = undefined
          })
        },
        generate: async (step) => {
          const override = queuedRunPromptRef.current
          const prompt = override ?? step.nextAction
          if (override !== null) setQueuedRunPrompt(null)
          showPhase('generating', { ...step, nextAction: prompt })
          return generateTurn(prompt, { scheduleTransition: false })
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
            DEFAULT_AUTOPLAY_TRANSITION_CYCLES,
            { validateCandidate: false },
          )
        },
      })

      if (!isCurrent()) return
      stopProgressionRun()
    })()
  }

  const clearSession = () => {
    const hadConversation = chat.messages.length > 0
    const previousSessionUi = {
      progressionStep: progressionStepRef.current,
      suggestions: flow.suggestions,
    }
    stopProgressionRun({ clearPlan: true })
    turnRequestRef.current++
    chat.clearChat()
    flow.setUiError(null)
    flow.setStagedCode(null)
    flow.showSuggestions([])
    setInput('')
    hideUndo()
    if (!hadConversation) return
    undoSessionUiRef.current = previousSessionUi
    setShowUndo(true)
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null
      undoSessionUiRef.current = null
      setShowUndo(false)
    }, UNDO_CLEAR_WINDOW_MS)
  }

  const undoClearSession = () => {
    const previousSessionUi = undoSessionUiRef.current
    if (chat.undoClearChat()) {
      flow.showSuggestions(previousSessionUi?.suggestions ?? [])
      setProgressionStep(previousSessionUi?.progressionStep ?? null)
    }
    hideUndo()
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      if (progressionRunViewRef.current.phase === 'idle') send(input)
      else steerRun(input)
    }
  }

  const isEmpty = chat.messages.length === 0
  const hasPattern = props.code.trim().length > 0
  // Settled messages only need transforming when the transcript changes.
  const transcript = useMemo(
    () =>
      chat.messages.map((message) => ({
        key: message.id,
        role: message.role,
        prose: message.role === 'assistant'
          ? visibleGeneratedTurnExplanation(message.content)
          : visibleTextWithoutCodeBlocks(message.content),
      })),
    [chat.messages],
  )
  const sessionError = flow.uiError ?? chat.error ?? chatStorageError
  const progressionRunning = progressionRun.phase !== 'idle'

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
        <div className="transcript" ref={transcriptRef}>
          <div className="transcript-log" role="log" aria-live="polite">
            {transcript.map((message) =>
              message.prose ? (
                <p key={message.key} className={message.role}>{message.prose}</p>
              ) : null,
            )}
            {generating ? (
              <span className="stream-dots" aria-label="Generating">
                <span>.</span><span>.</span><span>.</span>
              </span>
            ) : null}
          </div>
          {flow.stagedCode ? (
            <>
              <span className="sr-only" role="status">
                {flow.stagedTransitionScheduled
                  ? 'Revision ready. Crossfade scheduled in five seconds.'
                  : 'Revision ready to crossfade.'}
              </span>
              <MixRow flow={flow} playback={props.playback} />
            </>
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

      {!progressionRunning && hasPattern ? (
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

      {!progressionRunning && flow.suggestions.length > 0 ? (
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
          overrideQueued={queuedRunPrompt !== null}
          step={progressionStep}
          onDurationChange={(durationMs) => {
            setProgressionRunDurationMs(
              boundedProgressionRunDurationMs(durationMs),
            )
            setProgressionRunNotice(null)
          }}
          onStart={startProgressionRun}
          onStop={() => stopProgressionRun({ abortGeneration: true })}
          onXfadeNow={() => activeProgressionRunRef.current?.skipWait?.()}
        />
      ) : null}

      {sessionError ? <p className="error" role="alert">{sessionError}</p> : null}

      <form
        className={`prompt-form ${progressionRunning ? 'run-steer' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          if (progressionRunning) steerRun(input)
          else send(input)
        }}
      >
        {!progressionRunning ? (
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
        ) : null}
        <textarea
          aria-label={progressionRunning ? 'Steer the next transition' : 'Describe the music'}
          value={input}
          onChange={(event) => {
            hideUndo()
            setInput(event.target.value)
          }}
          onKeyDown={onInputKeyDown}
          placeholder={progressionRunning
            ? busy ? 'finishing this transition…' : 'steer the next transition…'
            : busy ? 'generating…' : 'describe your sound…'}
          rows={progressionRunning ? 1 : 2}
          maxLength={4000}
        />
        <button className="primary" disabled={busy || !input.trim()}>
          {progressionRunning ? 'STEER NEXT' : 'SEND'}
        </button>
      </form>
    </section>
  )
}

function ProgressionRow(props: {
  busy: boolean
  durationMs: number
  notice: string | null
  overrideQueued: boolean
  run: ProgressionRunView
  step: ProgressionStep | null
  onDurationChange(durationMs: number): void
  onStart(): void
  onStop(): void
  onXfadeNow(): void
}) {
  const running = props.run.phase !== 'idle'
  const action = props.run.phase === 'idle'
    ? props.step?.nextAction
    : props.run.nextAction
  const status = progressionRunStatus(props.run, props.notice)
  const progress = progressionWaitProgress(props.run)

  return (
    <div
      className={`progression-row phase-${props.run.phase} ${running ? 'running' : ''}`}
    >
      <span className="sr-only" role="status">
        {progressionRunAnnouncement(props.run, action, props.notice)}
      </span>
      <span className="chip-label">AUTOPLAY</span>
      <div className="progression-body">
        <div className="progression-head">
          {status ? (
            <strong role={props.run.phase === 'waiting' ? 'timer' : undefined}>
              {status}
            </strong>
          ) : null}
          {running ? (
            <span
              aria-hidden="true"
              className={`progression-meter ${progress === null ? 'indeterminate' : ''}`}
            >
              <span
                className="progression-meter-fill"
                style={progress === null ? undefined : { width: `${progress * 100}%` }}
              />
            </span>
          ) : null}
          <div className="progression-controls">
            {!running ? (
              <select
                aria-label="Run duration"
                className="run-duration"
                disabled={props.busy}
                value={props.durationMs}
                onChange={(event) => props.onDurationChange(Number(event.target.value))}
              >
                {PROGRESSION_RUN_DURATION_PRESETS_MS.map((durationMs) => (
                  <option key={durationMs} value={durationMs}>
                    {progressionRunDurationLabel(durationMs)}
                  </option>
                ))}
              </select>
            ) : null}
            {props.run.phase === 'waiting' ? (
              <button className="chrome run-now" onClick={props.onXfadeNow}>
                XFADE NOW
              </button>
            ) : null}
            <button
              className={`primary ${running ? 'stop' : ''}`}
              disabled={!running && props.busy}
              onClick={running ? props.onStop : props.onStart}
            >
              {running ? 'STOP RUN' : 'START RUN'}
            </button>
          </div>
        </div>
        {action ? (
          <p className="progression-action" title={action}>
            {props.overrideQueued ? <em>YOUR NEXT</em> : null}
            {action}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** How much of the current hold has already played, or null when the run is
 * not counting down a hold and the meter should read as indeterminate. */
function progressionWaitProgress(run: ProgressionRunView): number | null {
  if (run.phase !== 'waiting') return null
  if (run.remainingCycles === undefined || run.afterCycles <= 0) return null
  const elapsed = 1 - run.remainingCycles / run.afterCycles
  return Math.min(1, Math.max(0, elapsed))
}

function progressionRunAnnouncement(
  run: ProgressionRunView,
  nextAction: string | undefined,
  notice: string | null,
): string {
  switch (run.phase) {
    case 'idle':
      return notice ?? 'Autoplay is ready.'
    case 'starting':
      return 'Starting autoplay.'
    case 'waiting':
      return nextAction
        ? `Waiting for the next transition: ${nextAction}`
        : 'Waiting for the next transition.'
    case 'generating':
      return 'Generating the next transition.'
    case 'transitioning':
      return 'Crossfading to the next pattern.'
  }
}

function progressionRunStatus(
  run: ProgressionRunView,
  notice: string | null,
): string | null {
  switch (run.phase) {
    case 'idle':
      return notice
    case 'starting':
      return 'STARTING'
    case 'waiting':
      return run.remainingSeconds === undefined
        ? `NEXT IN ${run.afterCycles} CYCLES`
        : `NEXT IN ${progressionCountdownLabel(run.remainingSeconds)}`
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
  const [transitionCycles, setTransitionCycles] = useState(
    DEFAULT_MANUAL_TRANSITION_CYCLES,
  )
  const [remainingSeconds, setRemainingSeconds] = useState(
    MANUAL_XFADE_DELAY_MS / 1_000,
  )
  const transitionCyclesRef = useRef(transitionCycles)
  const transitionStagedRef = useRef(flow.transitionStaged)
  transitionCyclesRef.current = transitionCycles
  transitionStagedRef.current = flow.transitionStaged
  const mixing = playback.playbackState === 'transitioning'
  const scheduled = flow.stagedTransitionScheduled

  useEffect(() => {
    if (!scheduled) return
    const deadline = Date.now() + MANUAL_XFADE_DELAY_MS
    const updateCountdown = () => {
      setRemainingSeconds(Math.max(1, Math.ceil((deadline - Date.now()) / 1_000)))
    }
    updateCountdown()
    const countdownTimer = setInterval(updateCountdown, 250)
    const transitionTimer = setTimeout(() => {
      void transitionStagedRef.current(transitionCyclesRef.current)
    }, MANUAL_XFADE_DELAY_MS)
    return () => {
      clearInterval(countdownTimer)
      clearTimeout(transitionTimer)
    }
  }, [scheduled])

  return (
    <div className="mix-row" aria-live="off">
      <span className="chip-label" role={scheduled ? 'timer' : undefined}>
        {scheduled ? `XFADE IN ${remainingSeconds}s` : 'READY'}
      </span>
      <div className="mix-duration" role="group" aria-label="Crossfade duration">
        {TRANSITION_CYCLE_OPTIONS.map((cycles) => (
          <button
            key={cycles}
            aria-label={`${cycles} cycle crossfade`}
            aria-pressed={transitionCycles === cycles}
            className={`chip ${transitionCycles === cycles ? 'selected' : ''}`}
            disabled={mixing}
            title={`Crossfade over ${cycles} cycles`}
            onClick={() => setTransitionCycles(cycles)}
          >
            {cycles}
          </button>
        ))}
      </div>
      <div className="mix-actions">
        {scheduled ? (
          <button
            className="chrome"
            disabled={mixing}
            onClick={flow.cancelStagedTransition}
          >
            CANCEL
          </button>
        ) : null}
        <button
          className="primary"
          disabled={mixing}
          onClick={() => void flow.transitionStaged(transitionCycles)}
        >
          {mixing ? 'XFADING…' : scheduled ? 'XFADE NOW' : 'XFADE'}
        </button>
      </div>
    </div>
  )
}
