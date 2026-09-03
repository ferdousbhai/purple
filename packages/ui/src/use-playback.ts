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

const DEFAULT_TRANSITION_WAIT_TIMEOUT_MS = 60_000;
const MIN_TRANSITION_WAIT_TIMEOUT_MS = 30_000;
const MAX_TRANSITION_WAIT_TIMEOUT_MS = 10 * 60_000;
const TRANSITION_POLL_MS = 50;

function cycleDurationMs(
  remainingCycles: number,
  cyclesPerSecond: number,
): number | null {
  return Number.isFinite(remainingCycles) &&
    Number.isFinite(cyclesPerSecond) &&
    remainingCycles >= 0 &&
    cyclesPerSecond > 0
    ? (remainingCycles / cyclesPerSecond) * 1_000
    : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Allow twice the scheduler's expected duration plus startup slack. */
export function transitionWaitTimeoutMs(
  remainingCycles: number,
  cyclesPerSecond: number,
): number {
  const expectedMs = cycleDurationMs(remainingCycles, cyclesPerSecond);
  return expectedMs === null
    ? DEFAULT_TRANSITION_WAIT_TIMEOUT_MS
    : clamp(
        expectedMs * 2 + 10_000,
        MIN_TRANSITION_WAIT_TIMEOUT_MS,
        MAX_TRANSITION_WAIT_TIMEOUT_MS,
      );
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

/** The transport is doing something the STOP control should interrupt. */
export function isTransportActive(state: PlaybackState): boolean {
  return (
    state === "playing" || state === "loading" || state === "transitioning"
  );
}

/** The editor holds a change the listener has not applied to live playback. */
export function hasUnappliedEditorChanges(
  playbackState: PlaybackState,
  editorCode: string,
  activeCode: string,
): boolean {
  return playbackState === "playing" && editorCode !== activeCode;
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
  const playQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cancelCycleWaitRef = useRef<(() => void) | null>(null);
  stateRef.current = state;

  const cancelCycleWait = useCallback(() => {
    cancelCycleWaitRef.current?.();
    cancelCycleWaitRef.current = null;
  }, []);

  const beginOperation = useCallback(
    async (state: "loading" | "transitioning") => {
      const operation = ++operationRef.current;
      cancelCycleWait();
      dispatch({ type: state });
      const release = await waitForPlaybackTurn(playQueueRef);
      return { operation, release };
    },
    [cancelCycleWait],
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
    (result: EvalResult, code: string): void => {
      if (result.ok) {
        dispatch({ type: "playing", code });
        return;
      }
      if (result.kind === "cancelled") return;
      hush();
      dispatch({ type: "error", error: result.error });
    },
    [hush],
  );

  const evaluateCandidate = useCallback(
    async (
      code: string,
      operation: number,
      evaluateOptions?: { hushBefore?: boolean },
    ): Promise<EvalResult> => {
      const result = await evaluate(code, evaluateOptions);
      if (discardOvertakenEvaluation(operation)) {
        return { ok: false, kind: "cancelled" };
      }
      commitCandidateResult(result, code);
      return result;
    },
    [commitCandidateResult, discardOvertakenEvaluation, evaluate],
  );

  const play = useCallback(
    async (code: string): Promise<EvalResult> => {
      const { operation, release } = await beginOperation("loading");

      try {
        const activation = await activateOperation(operation);
        if (!activation.ok) return activation;

        return evaluateCandidate(code, operation);
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
          if (cancelCycleWaitRef.current === cancel) {
            cancelCycleWaitRef.current = null;
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
            if (targetCycle - getSchedulerPosition().cycle <= 0) {
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

          timeoutId = window.setTimeout(poll, TRANSITION_POLL_MS);
        };

        cancelCycleWaitRef.current = cancel;
        let deadlineMs = DEFAULT_TRANSITION_WAIT_TIMEOUT_MS;
        try {
          const position = getSchedulerPosition();
          const remainingCycles = Math.max(0, targetCycle - position.cycle);
          deadlineMs = transitionWaitTimeoutMs(remainingCycles, position.cps);
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
    ): Promise<EvalResult> => {
      const current = stateRef.current;
      if (current.playbackState !== "playing" || !current.activeCode) {
        return play(nextCode);
      }

      const fromCode = current.activeCode;
      const { operation, release } = await beginOperation("transitioning");

      try {
        const activation = await activateOperation(operation);
        if (!activation.ok) return activation;

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
          dispatch({ type: "transitionFailed", code: fromCode, error });
          return { ok: false, kind: "evaluation", error };
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
            return transitionResult;
          }
          dispatch({
            type: "transitionFailed",
            code: fromCode,
            error: transitionResult.error,
          });
          return transitionResult;
        }

        const waitResult = await waitForCycle(
          startCycle + durationCycles,
          operation,
        );
        if (!waitResult.ok) {
          if (waitResult.kind !== "cancelled") {
            hush();
            dispatch({ type: "error", error: waitResult.error });
          }
          return waitResult;
        }

        return evaluateCandidate(nextCode, operation, { hushBefore: false });
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
    ++operationRef.current;
    cancelCycleWait();
    hush();
    dispatch({ type: "stopped" });
  }, [cancelCycleWait, hush]);

  useEffect(() => cancelCycleWait, [cancelCycleWait]);

  return {
    ...state,
    play,
    transition,
    stop,
    validatePattern: validate,
    getActiveSourceRanges,
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
