import { useEffect, useReducer, useCallback, useRef } from "react";
import { useStrudel } from "./useStrudel";
import type { PlaybackState, EvalResult, SourceRange } from "../../shared/types";

type AudioActivationResult =
  | { ok: true }
  | { ok: false; kind: "audio"; error: string };

export function usePlayback() {
  const { activate, evaluate, hush, getActiveSourceRanges } = useStrudel();
  const [state, dispatch] = useReducer(playbackReducer, INITIAL_PLAYBACK_STATE);
  const operationRef = useRef(0);
  const playQueueRef = useRef<Promise<void>>(Promise.resolve());

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
          dispatch({ type: "error", error: result.error });
        }
        return result;
      } finally {
        releaseQueue();
      }
    },
    [activateAudio, evaluate, hush],
  );

  const stop = useCallback(() => {
    ++operationRef.current;
    hush();
    dispatch({ type: "stopped" });
  }, [hush]);

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
    play,
    stop,
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
  | { type: "playing"; code: string }
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
