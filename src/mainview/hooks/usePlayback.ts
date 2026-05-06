import { useState, useCallback } from "react";
import { useStrudel } from "./useStrudel";
import type { PlaybackState, EvalResult } from "../../shared/types";

export function usePlayback() {
  const { isReady, acquireAudioContext, init, evaluate, hush } = useStrudel();
  const [playbackState, setPlaybackState] = useState<PlaybackState>("stopped");
  const [error, setError] = useState<string | null>(null);

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
        setPlaybackState("playing");
      } else {
        setPlaybackState("error");
        setError(result.error ?? "Evaluation failed");
      }
      return result;
    },
    [evaluate],
  );

  const stop = useCallback(() => {
    hush();
    setPlaybackState("stopped");
  }, [hush]);

  return { isReady, playbackState, error, initAudio, play, stop };
}
