import { useEffect, useReducer, useCallback, useRef } from "react";
import { useStrudel, type StrudelAudioOptions } from "./use-strudel";
import type { PlaybackState, EvalResult } from "@purple/core/types";
import {
  buildTransitionCode,
  DEFAULT_TRANSITION_CYCLES,
  getTransitionStartCycle,
} from "@purple/core/transitions";

type AudioActivationResult =
  | { ok: true }
  | { ok: false; kind: "audio"; error: string };

export interface PlaybackAttemptOptions {
  /** Generated patterns repair evaluation failures out of sight. Audio
   * failures still surface because asking the model cannot fix them. */
  reportEvaluationError?: boolean;
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; kind: "audio"; error: string }
  | { ok: false; kind: "cancelled" }
  | {
      ok: false;
      kind: "evaluation";
      error: string;
      source: "candidate" | "transition";
    };

const DEFAULT_TRANSITION_WAIT_TIMEOUT_MS = 60_000;
const MIN_TRANSITION_WAIT_TIMEOUT_MS = 30_000;
const MAX_TRANSITION_WAIT_TIMEOUT_MS = 10 * 60_000;

/** Allow twice the scheduler's expected duration plus startup slack. */
export function transitionWaitTimeoutMs(
  remainingCycles: number,
  cyclesPerSecond: number,
): number {
  if (
    !Number.isFinite(remainingCycles) ||
    !Number.isFinite(cyclesPerSecond) ||
    remainingCycles < 0 ||
    cyclesPerSecond <= 0
  ) {
    return DEFAULT_TRANSITION_WAIT_TIMEOUT_MS;
  }
  const expectedMs = (remainingCycles / cyclesPerSecond) * 1000;
  return Math.min(
    MAX_TRANSITION_WAIT_TIMEOUT_MS,
    Math.max(MIN_TRANSITION_WAIT_TIMEOUT_MS, expectedMs * 2 + 10_000),
  );
}

function classifyTransitionResult(
  result: EvalResult,
  source: "candidate" | "transition",
): TransitionResult {
  if (result.ok || result.kind === "cancelled") return result;
  if (result.kind === "audio") {
    return { ok: false, kind: "audio", error: result.error };
  }
  return { ok: false, kind: "evaluation", error: result.error, source };
}

interface PlaybackQueue {
  current: Promise<void>;
}

/** Serialize scheduler replacements so an overtaken evaluation cannot land late. */
async function waitForPlaybackTurn(queue: PlaybackQueue): Promise<() => void> {
  let release = (): void => {};
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previousTurn = queue.current;
  queue.current = turn;
  await previousTurn;
  return release;
}

export function usePlayback(options: StrudelAudioOptions = {}) {
  const {
    activate,
    evaluate,
    validate,
    hush,
    getSchedulerPosition,
    getActiveSourceRanges,
    getOutputAnalyser,
  } = useStrudel(options);
  const [state, dispatch] = useReducer(playbackReducer, INITIAL_PLAYBACK_STATE);
  const stateRef = useRef(state);
  const operationRef = useRef(0);
  const stopTokenRef = useRef(0);
  const playQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cancelTransitionWaitRef = useRef<(() => void) | null>(null);
  stateRef.current = state;

  const cancelTransitionWait = useCallback(() => {
    cancelTransitionWaitRef.current?.();
    cancelTransitionWaitRef.current = null;
  }, []);

  const beginOperation = useCallback(
    async (state: "loading" | "transitioning") => {
      const operation = ++operationRef.current;
      cancelTransitionWait();
      dispatch({ type: state });
      const release = await waitForPlaybackTurn(playQueueRef);
      return { operation, release };
    },
    [cancelTransitionWait],
  );

  const activateAudio = useCallback(async (): Promise<AudioActivationResult> => {
    try {
      await activate();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, kind: "audio" };
    }
  }, [activate]);

  /** Start engine initialization from the Send gesture so generated-pattern
   * validation can run before the visitor explicitly starts playback. */
  const prepareValidation = useCallback(async (): Promise<EvalResult> => {
    const result = await activateAudio();
    if (!result.ok) dispatch({ type: "error", error: result.error });
    return result;
  }, [activateAudio]);

  const activateOperation = useCallback(
    async (operation: number): Promise<EvalResult> => {
      if (operation !== operationRef.current) {
        return { ok: false, kind: "cancelled" };
      }
      const activation = await activateAudio();
      if (operation !== operationRef.current) {
        return { ok: false, kind: "cancelled" };
      }
      if (!activation.ok) dispatch({ type: "error", error: activation.error });
      return activation;
    },
    [activateAudio],
  );

  const discardOvertakenEvaluation = useCallback(
    (operation: number): boolean => {
      if (operation === operationRef.current) return false;
      hush();
      return true;
    },
    [hush],
  );

  const commitCandidateResult = useCallback(
    (
      result: EvalResult,
      code: string,
      attemptOptions: PlaybackAttemptOptions,
    ): void => {
      if (result.ok) {
        dispatch({ type: "playing", code });
        return;
      }
      if (result.kind === "cancelled") return;
      hush();
      dispatch(
        attemptOptions.reportEvaluationError === false &&
          result.kind === "evaluation"
          ? { type: "stopped" }
          : { type: "error", error: result.error },
      );
    },
    [hush],
  );

  const evaluateCandidate = useCallback(
    async (
      code: string,
      operation: number,
      attemptOptions: PlaybackAttemptOptions,
      evaluateOptions?: { hushBefore?: boolean },
    ): Promise<EvalResult> => {
      const result = await evaluate(code, evaluateOptions);
      if (discardOvertakenEvaluation(operation)) {
        return { ok: false, kind: "cancelled" };
      }
      commitCandidateResult(result, code, attemptOptions);
      return result;
    },
    [commitCandidateResult, discardOvertakenEvaluation, evaluate],
  );

  const play = useCallback(
    async (
      code: string,
      attemptOptions: PlaybackAttemptOptions = {},
    ): Promise<EvalResult> => {
      const { operation, release } = await beginOperation("loading");

      try {
        const activation = await activateOperation(operation);
        if (!activation.ok) return activation;

        return evaluateCandidate(code, operation, attemptOptions);
      } finally {
        release();
      }
    },
    [
      activateOperation,
      beginOperation,
      evaluateCandidate,
    ],
  );

  const waitForCycle = useCallback(
    (targetCycle: number, operation: number): Promise<EvalResult> =>
      new Promise((resolve) => {
        let timeoutId: number | undefined;
        let deadlineId: number | undefined;
        let settled = false;

        const finish = (result: EvalResult) => {
          if (settled) return;
          settled = true;
          if (timeoutId !== undefined) window.clearTimeout(timeoutId);
          if (deadlineId !== undefined) window.clearTimeout(deadlineId);
          if (cancelTransitionWaitRef.current === cancel) {
            cancelTransitionWaitRef.current = null;
          }
          resolve(result);
        };

        const cancel = () => finish({ ok: false, kind: "cancelled" });
        const poll = () => {
          if (operation !== operationRef.current) {
            cancel();
            return;
          }

          try {
            if (getSchedulerPosition().cycle >= targetCycle) {
              finish({ ok: true });
              return;
            }
          } catch (timingError) {
            const message =
              timingError instanceof Error
                ? timingError.message
                : String(timingError);
            finish({ ok: false, kind: "evaluation", error: message });
            return;
          }

          timeoutId = window.setTimeout(poll, 50);
        };

        cancelTransitionWaitRef.current = cancel;
        let deadlineMs = DEFAULT_TRANSITION_WAIT_TIMEOUT_MS;
        try {
          const position = getSchedulerPosition();
          deadlineMs = transitionWaitTimeoutMs(
            Math.max(0, targetCycle - position.cycle),
            position.cps,
          );
        } catch {
          // The first poll below reports the scheduler error immediately.
        }
        deadlineId = window.setTimeout(
          () =>
            finish({
              ok: false,
              kind: "evaluation",
              error: "The crossfade did not finish before its timing deadline.",
            }),
          deadlineMs,
        );
        poll();
      }),
    [getSchedulerPosition],
  );

  const transition = useCallback(
    async (
      nextCode: string,
      durationCycles = DEFAULT_TRANSITION_CYCLES,
      attemptOptions: PlaybackAttemptOptions = {},
    ): Promise<TransitionResult> => {
      const current = stateRef.current;
      if (current.playbackState !== "playing" || !current.activeCode) {
        return classifyTransitionResult(
          await play(nextCode, attemptOptions),
          "candidate",
        );
      }

      const fromCode = current.activeCode;
      const { operation, release } = await beginOperation("transitioning");

      try {
        const activation = await activateOperation(operation);
        if (!activation.ok) return classifyTransitionResult(activation, "candidate");

        let startCycle: number;
        let transitionCode: string;
        try {
          startCycle = getTransitionStartCycle(
            getSchedulerPosition().cycle,
          );
          transitionCode = buildTransitionCode(
            fromCode,
            nextCode,
            startCycle,
            durationCycles,
          );
        } catch (timingError) {
          const error =
            timingError instanceof Error
              ? timingError.message
              : String(timingError);
          if (attemptOptions.reportEvaluationError === false) {
            dispatch({ type: "transitionRestored", code: fromCode });
          } else {
            dispatch({ type: "transitionFailed", code: fromCode, error });
          }
          return { ok: false, kind: "evaluation", error, source: "transition" };
        }

        const transitionResult = await evaluate(transitionCode, {
          hushBefore: false,
        });
        if (discardOvertakenEvaluation(operation)) {
          return { ok: false, kind: "cancelled" };
        }
        if (!transitionResult.ok) {
          if (transitionResult.kind === "cancelled") return transitionResult;
          if (transitionResult.kind === "audio") {
            dispatch({ type: "error", error: transitionResult.error });
            return {
              ok: false,
              kind: "audio",
              error: transitionResult.error,
            };
          }
          dispatch(
            attemptOptions.reportEvaluationError === false
              ? { type: "transitionRestored", code: fromCode }
              : {
                  type: "transitionFailed",
                  code: fromCode,
                  error: transitionResult.error,
                },
          );
          return {
            ok: false,
            kind: "evaluation",
            error: transitionResult.error,
            source: "transition",
          };
        }

        const waitResult = await waitForCycle(
          startCycle + durationCycles,
          operation,
        );
        if (!waitResult.ok) {
          if (waitResult.kind !== "cancelled") {
            hush();
            dispatch(
              attemptOptions.reportEvaluationError === false
                ? { type: "stopped" }
                : { type: "error", error: waitResult.error },
            );
          }
          return classifyTransitionResult(waitResult, "transition");
        }

        const finalResult = await evaluateCandidate(
          nextCode,
          operation,
          attemptOptions,
          { hushBefore: false },
        );
        return classifyTransitionResult(finalResult, "candidate");
      } finally {
        release();
      }
    },
    [
      activateOperation,
      beginOperation,
      discardOvertakenEvaluation,
      evaluate,
      evaluateCandidate,
      getSchedulerPosition,
      hush,
      play,
      waitForCycle,
    ],
  );

  const stop = useCallback(() => {
    stopTokenRef.current++;
    ++operationRef.current;
    cancelTransitionWait();
    hush();
    dispatch({ type: "stopped" });
  }, [cancelTransitionWait, hush]);

  const getStopToken = useCallback(() => stopTokenRef.current, []);

  useEffect(() => cancelTransitionWait, [cancelTransitionWait]);

  return {
    ...state,
    prepareValidation,
    play,
    transition,
    stop,
    /** Changes only for an explicit Stop action, not an internal eval failure. */
    getStopToken,
    /** Audit generated code against the live engine without touching playback. */
    validatePattern: validate,
    /** Read scheduler highlights without routing its 50 ms poll through React. */
    getActiveSourceRanges,
    /** The master-mix tap, or null until the engine initializes. */
    getOutputAnalyser,
  };
}

interface PlaybackSnapshot {
  playbackState: PlaybackState;
  error: string | null;
  activeCode: string;
}

type PlaybackAction =
  | { type: "loading" }
  | { type: "transitioning" }
  | { type: "playing"; code: string }
  | { type: "transitionRestored"; code: string }
  | { type: "transitionFailed"; code: string; error: string }
  | { type: "error"; error: string }
  | { type: "stopped" };

const INITIAL_PLAYBACK_STATE: PlaybackSnapshot = {
  playbackState: "stopped",
  error: null,
  activeCode: "",
};

function playingSnapshot(code: string, error: string | null = null): PlaybackSnapshot {
  return {
    playbackState: "playing",
    error,
    activeCode: code,
  };
}

function playbackReducer(
  state: PlaybackSnapshot,
  action: PlaybackAction,
): PlaybackSnapshot {
  switch (action.type) {
    case "loading":
      return { ...INITIAL_PLAYBACK_STATE, playbackState: "loading" };
    case "playing":
      return playingSnapshot(action.code);
    case "transitioning":
      return {
        ...state,
        playbackState: "transitioning",
        error: null,
      };
    case "transitionFailed":
      return playingSnapshot(action.code, action.error);
    case "transitionRestored":
      return playingSnapshot(action.code);
    case "error":
      return {
        ...INITIAL_PLAYBACK_STATE,
        playbackState: "error",
        error: action.error,
      };
    case "stopped":
      return INITIAL_PLAYBACK_STATE;
  }
}
