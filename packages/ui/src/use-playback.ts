import { useEffect, useReducer, useCallback, useRef } from "react";
import { useStrudel, type StrudelAudioOptions } from "./use-strudel";
import type { PlaybackState, EvalResult, SourceRange } from "@purple/core/types";
import {
  buildTransitionCode,
  DEFAULT_TRANSITION_CYCLES,
  getTransitionStartCycle,
} from "@purple/core/transitions";

type AudioActivationResult =
  | { ok: true }
  | { ok: false; kind: "audio"; error: string };

export function usePlayback(options: StrudelAudioOptions = {}) {
  const {
    activate,
    evaluate,
    validate,
    hush,
    isAudioReady,
    getSchedulerPosition,
    getActiveSourceRanges,
  } = useStrudel(options);
  const [state, dispatch] = useReducer(playbackReducer, INITIAL_PLAYBACK_STATE);
  const stateRef = useRef(state);
  const operationRef = useRef(0);
  const playQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cancelTransitionWaitRef = useRef<(() => void) | null>(null);
  stateRef.current = state;

  const cancelTransitionWait = useCallback(() => {
    cancelTransitionWaitRef.current?.();
    cancelTransitionWaitRef.current = null;
  }, []);

  const activateAudio = useCallback(async (): Promise<AudioActivationResult> => {
    try {
      await activate();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, kind: "audio" };
    }
  }, [activate]);

  const prepareAudio = useCallback(async (): Promise<EvalResult> => {
    const result = await activateAudio();
    if (!result.ok) {
      dispatch({ type: "error", error: result.error });
    }
    return result;
  }, [activateAudio]);

  const play = useCallback(
    async (code: string): Promise<EvalResult> => {
      const operation = ++operationRef.current;
      cancelTransitionWait();
      dispatch({ type: "loading" });

      let releaseQueue: () => void = () => {};
      const queueTurn = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      const previousTurn = playQueueRef.current;
      playQueueRef.current = queueTurn;
      await previousTurn;

      try {
        if (operation !== operationRef.current) {
          return { ok: false, kind: "cancelled" };
        }

        const activation = await activateAudio();
        if (operation !== operationRef.current) {
          return { ok: false, kind: "cancelled" };
        }
        if (!activation.ok) {
          dispatch({ type: "error", error: activation.error });
          return activation;
        }

        const result = await evaluate(code);
        if (operation !== operationRef.current) {
          hush();
          return { ok: false, kind: "cancelled" };
        }
        if (result.ok) {
          dispatch({ type: "playing", code });
        } else {
          if (result.kind === "cancelled") return result;
          hush();
          dispatch({ type: "error", error: result.error });
        }
        return result;
      } finally {
        releaseQueue();
      }
    },
    [activateAudio, cancelTransitionWait, evaluate, hush],
  );

  const waitForCycle = useCallback(
    (targetCycle: number, operation: number): Promise<EvalResult> =>
      new Promise((resolve) => {
        let timeoutId: number | undefined;
        let settled = false;

        const finish = (result: EvalResult) => {
          if (settled) return;
          settled = true;
          if (timeoutId !== undefined) window.clearTimeout(timeoutId);
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
      const operation = ++operationRef.current;
      cancelTransitionWait();
      dispatch({ type: "transitioning" });

      let releaseQueue: () => void = () => {};
      const queueTurn = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      const previousTurn = playQueueRef.current;
      playQueueRef.current = queueTurn;
      await previousTurn;

      try {
        if (operation !== operationRef.current) {
          return { ok: false, kind: "cancelled" };
        }

        const activation = await activateAudio();
        if (operation !== operationRef.current) {
          return { ok: false, kind: "cancelled" };
        }
        if (!activation.ok) {
          dispatch({ type: "error", error: activation.error });
          return activation;
        }

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
        if (operation !== operationRef.current) {
          hush();
          return { ok: false, kind: "cancelled" };
        }
        if (!transitionResult.ok) {
          if (transitionResult.kind === "cancelled") return transitionResult;
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

        const finalResult = await evaluate(nextCode, { hushBefore: false });
        if (operation !== operationRef.current) {
          hush();
          return { ok: false, kind: "cancelled" };
        }
        if (finalResult.ok) {
          dispatch({ type: "playing", code: nextCode });
        } else if (finalResult.kind !== "cancelled") {
          hush();
          dispatch({ type: "error", error: finalResult.error });
        }
        return finalResult;
      } finally {
        releaseQueue();
      }
    },
    [
      activateAudio,
      cancelTransitionWait,
      evaluate,
      getSchedulerPosition,
      hush,
      play,
      waitForCycle,
    ],
  );

  const stop = useCallback(() => {
    ++operationRef.current;
    cancelTransitionWait();
    hush();
    dispatch({ type: "stopped" });
  }, [cancelTransitionWait, hush]);

  useEffect(() => cancelTransitionWait, [cancelTransitionWait]);

  useEffect(() => {
    if (state.playbackState !== "playing") return;

    let lastKey = "";
    const update = () => {
      const ranges = getActiveSourceRanges();
      const key = getRangesKey(ranges);
      if (key !== lastKey) {
        lastKey = key;
        dispatch({ type: "ranges", ranges });
      }
    };

    update();
    const intervalId = window.setInterval(update, 50);
    return () => window.clearInterval(intervalId);
  }, [getActiveSourceRanges, state.playbackState]);

  return {
    ...state,
    prepareAudio,
    isAudioReady,
    play,
    transition,
    stop,
    /** Audit generated code against the live engine without touching playback. */
    validatePattern: validate,
  };
}

interface PlaybackSnapshot {
  playbackState: PlaybackState;
  error: string | null;
  activeCode: string;
  activeRanges: readonly SourceRange[];
}

type PlaybackAction =
  | { type: "loading" }
  | { type: "transitioning" }
  | { type: "playing"; code: string }
  | { type: "transitionFailed"; code: string; error: string }
  | { type: "error"; error: string }
  | { type: "stopped" }
  | { type: "ranges"; ranges: readonly SourceRange[] };

const INITIAL_PLAYBACK_STATE: PlaybackSnapshot = {
  playbackState: "stopped",
  error: null,
  activeCode: "",
  activeRanges: [],
};

function playbackReducer(
  state: PlaybackSnapshot,
  action: PlaybackAction,
): PlaybackSnapshot {
  switch (action.type) {
    case "loading":
      return { ...INITIAL_PLAYBACK_STATE, playbackState: "loading" };
    case "playing":
      return {
        playbackState: "playing",
        error: null,
        activeCode: action.code,
        activeRanges: [],
      };
    case "transitioning":
      return {
        ...state,
        playbackState: "transitioning",
        error: null,
        activeRanges: [],
      };
    case "transitionFailed":
      return {
        playbackState: "playing",
        error: action.error,
        activeCode: action.code,
        activeRanges: [],
      };
    case "error":
      return {
        ...INITIAL_PLAYBACK_STATE,
        playbackState: "error",
        error: action.error,
      };
    case "stopped":
      return INITIAL_PLAYBACK_STATE;
    case "ranges":
      return state.playbackState === "playing"
        ? { ...state, activeRanges: action.ranges }
        : state;
  }
}

function getRangesKey(ranges: readonly SourceRange[]) {
  return ranges.map((range) => range.join(":")).join("|");
}
