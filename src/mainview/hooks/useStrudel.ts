import { useRef, useCallback, useState } from "react";
import type { EvalResult } from "../../shared/types";

export function useStrudel() {
  const [isReady, setIsReady] = useState(false);
  const strudelRef = useRef<typeof import("@strudel/web/web.mjs") | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Must be called synchronously in a user gesture (click/keypress) handler
  // so the browser allows AudioContext creation and resume.
  const acquireAudioContext = useCallback(() => {
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.resume().catch(() => {});
      return audioCtxRef.current;
    }

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    ctx.resume().catch(() => {});
    console.log("[Strudel] AudioContext created in gesture, state:", ctx.state);
    return ctx;
  }, []);

  const init = useCallback(
    async (ctx: AudioContext) => {
      if (strudelRef.current) return;
      if (initPromiseRef.current) return initPromiseRef.current;

      const promise = (async () => {
        console.log("[Strudel] Starting init...");
        const strudel = await import("@strudel/web/web.mjs");
        console.log("[Strudel] Module imported");

        // Ensure context is running (resume may have completed async)
        if (ctx.state === "suspended") await ctx.resume();
        console.log("[Strudel] AudioContext state:", ctx.state);

        await strudel.initStrudel({
          audioContext: ctx,
          prebake: () =>
            strudel.samples("github:tidalcycles/Dirt-Samples/master"),
        });
        console.log("[Strudel] initStrudel done");

        await strudel.initAudio();
        console.log("[Strudel] initAudio done");

        strudelRef.current = strudel;
        setIsReady(true);
      })();

      initPromiseRef.current = promise;

      try {
        await promise;
      } catch (err) {
        console.error("[Strudel] Init failed:", err);
        initPromiseRef.current = null; // Allow retry
        throw err;
      }
    },
    [],
  );

  const evaluate = useCallback(async (code: string): Promise<EvalResult> => {
    const strudel = strudelRef.current;
    if (!strudel) {
      return {
        ok: false,
        error: "Audio engine not initialized — click Play to retry",
      };
    }

    try {
      const ctx = strudel.getAudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      await strudel.evaluate(code, true);
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }, []);

  const hush = useCallback(() => {
    strudelRef.current?.hush();
  }, []);

  return { isReady, acquireAudioContext, init, evaluate, hush };
}
