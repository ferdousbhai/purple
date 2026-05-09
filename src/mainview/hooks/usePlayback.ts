import { useEffect, useState, useCallback } from "react";
import { useStrudel } from "./useStrudel";
import type { PlaybackState, EvalResult, SourceRange } from "../../shared/types";

export function usePlayback() {
  const {
    isReady,
    acquireAudioContext,
    init,
    evaluate,
    hush,
    getActiveSourceRanges,
  } = useStrudel();
  const [playbackState, setPlaybackState] = useState<PlaybackState>("stopped");
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState("");
  const [activeRanges, setActiveRanges] = useState<readonly SourceRange[]>([]);

  const clearActivePlayback = useCallback(() => {
    setActiveCode("");
    setActiveRanges([]);
  }, []);

  // Call this synchronously from a click/keypress handler so AudioContext
  // is created within the user gesture's call stack.
  const initAudio = useCallback(async () => {
    const ctx = acquireAudioContext(); // sync — must be in gesture
    try {
      await init(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Audio init failed: ${message}`);
      setPlaybackState("error");
    }
  }, [acquireAudioContext, init]);

  const play = useCallback(
    async (code: string): Promise<EvalResult> => {
      setPlaybackState("loading");
      setError(null);

      const result = await evaluate(code);
      if (result.ok) {
        setActiveCode(code);
        setPlaybackState("playing");
      } else {
        setPlaybackState("error");
        setError(result.error ?? "Evaluation failed");
        clearActivePlayback();
      }
      return result;
    },
    [clearActivePlayback, evaluate],
  );

  const stop = useCallback(() => {
    hush();
    setPlaybackState("stopped");
    clearActivePlayback();
  }, [clearActivePlayback, hush]);

  useEffect(() => {
    if (playbackState !== "playing") {
      setActiveRanges([]);
      return;
    }

    let frameId = 0;
    let lastKey = "";
    const update = () => {
      const ranges = getActiveSourceRanges();
      const key = getRangesKey(ranges);
      if (key !== lastKey) {
        lastKey = key;
        setActiveRanges(ranges);
      }
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [getActiveSourceRanges, playbackState]);

  return {
    isReady,
    playbackState,
    error,
    activeCode,
    activeRanges,
    initAudio,
    play,
    stop,
  };
}

function getRangesKey(ranges: readonly SourceRange[]) {
  return ranges.map((range) => range.join(":")).join("|");
}
