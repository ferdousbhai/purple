import { useRef, useCallback, useEffect } from "react";
import type {
  StrudelHap,
  StrudelPattern,
  StrudelRepl,
} from "@strudel/web/web.mjs";
import type { EvalResult, SourceRange } from "../../shared/types";
import { requireRunningAudioContext } from "../audio-activation";

type StrudelModule = typeof import("@strudel/web/web.mjs");

export interface SchedulerPosition {
  cycle: number;
  cps: number;
}

export function useStrudel() {
  const strudelRef = useRef<StrudelModule | null>(null);
  const replRef = useRef<StrudelRepl | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activePatternRef = useRef<StrudelPattern | null>(null);
  const lastEvaluationErrorRef = useRef<Error | null>(null);

  const acquireAudioContext = useCallback(() => {
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      return audioCtxRef.current;
    }

    if (audioCtxRef.current?.state === "closed") {
      strudelRef.current = null;
      replRef.current = null;
      initPromiseRef.current = null;
      activePatternRef.current = null;
    }

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    return ctx;
  }, []);

  const init = useCallback(
    async (ctx: AudioContext) => {
      if (strudelRef.current) return;
      if (initPromiseRef.current) return initPromiseRef.current;

      const promise = (async () => {
        const strudel = await import("@strudel/web/web.mjs");

        const repl = await strudel.initStrudel({
          audioContext: ctx,
          onEvalError: (error) => {
            lastEvaluationErrorRef.current = error;
          },
          // defaultPrebake() registers synths only, so the Dirt-Samples bank
          // has to be loaded explicitly for sample-based patterns to play.
          prebake: () =>
            strudel.samples("github:tidalcycles/Dirt-Samples/master"),
        });

        await strudel.initAudio();

        strudelRef.current = strudel;
        replRef.current = repl;
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

  // Call from a click or key handler. requireRunningAudioContext invokes
  // resume() before its first await, preserving the browser's user activation.
  const activate = useCallback(async () => {
    const ctx = acquireAudioContext();
    await requireRunningAudioContext(ctx);
    await init(ctx);
    await requireRunningAudioContext(ctx);
  }, [acquireAudioContext, init]);

  const evaluate = useCallback(async (
    code: string,
    options: { hushBefore?: boolean } = {},
  ): Promise<EvalResult> => {
    const strudel = strudelRef.current;
    const repl = replRef.current;
    if (!strudel || !repl) {
      return {
        ok: false,
        error: "Audio engine not initialized — click Play to retry",
        kind: "audio",
      };
    }

    try {
      const ctx = strudel.getAudioContext();
      if (String(ctx.state) !== "running") {
        return {
          ok: false,
          error: `Audio output is blocked (${String(ctx.state)}). Click Play to enable sound.`,
          kind: "audio",
        };
      }

      lastEvaluationErrorRef.current = null;
      // @strudel/web's exported evaluate() wrapper drops its third argument.
      // Calling the initialized REPL directly is required to keep the scheduler
      // running while a cycle-aligned crossfade replaces the active pattern.
      const pattern = await repl.evaluate(
        code,
        true,
        options.hushBefore ?? true,
      );
      if (!isStrudelPattern(pattern)) {
        // Read through a helper: onEvalError writes this ref from Strudel's own
        // callback, so the reset above does not describe its current value.
        const message = evaluationErrorMessage(lastEvaluationErrorRef.current);
        return { ok: false, error: message, kind: "evaluation" };
      }

      activePatternRef.current = pattern;
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, kind: "evaluation" };
    }
  }, []);

  const hush = useCallback(() => {
    strudelRef.current?.hush();
    activePatternRef.current = null;
  }, []);

  const getSchedulerPosition = useCallback((): SchedulerPosition => {
    const strudel = strudelRef.current;
    if (!strudel) throw new Error("Audio engine is not initialized.");

    const cycle = strudel.getTime();
    const cps = Number(strudel.getCps());
    if (!Number.isFinite(cycle) || !Number.isFinite(cps) || cps <= 0) {
      throw new Error("Strudel scheduler timing is unavailable.");
    }

    return { cycle, cps };
  }, []);

  const getActiveSourceRanges = useCallback((): SourceRange[] => {
    const pattern = activePatternRef.current;
    const strudel = strudelRef.current;
    if (!pattern || !strudel) return [];

    try {
      const time = strudel.getTime();
      const haps = pattern
        .queryArc(time - 1, time + 1, {
          _cps: strudel.getCps(),
          cyclist: "riff-highlight",
        })
        .filter((hap) => hap.isActive?.(time));

      return sourceRangesFromHaps(haps);
    } catch (err) {
      console.warn("[Strudel] Highlight query failed:", err);
      return [];
    }
  }, []);

  useEffect(() => {
    return () => {
      strudelRef.current?.hush();
      replRef.current = null;
      activePatternRef.current = null;
      const context = audioCtxRef.current;
      if (context && context.state !== "closed") void context.close();
    };
  }, []);

  return {
    activate,
    evaluate,
    hush,
    getSchedulerPosition,
    getActiveSourceRanges,
  };
}

function evaluationErrorMessage(error: Error | null): string {
  return error?.message ?? "Strudel could not evaluate this pattern.";
}

function isStrudelPattern(
  value: StrudelPattern | undefined,
): value is StrudelPattern {
  return value != null && typeof value.queryArc === "function";
}

function sourceRangesFromHaps(haps: readonly StrudelHap[]): SourceRange[] {
  const seen = new Set<string>();
  const ranges: SourceRange[] = [];

  for (const hap of haps) {
    for (const location of hap.context?.locations ?? []) {
      const range: SourceRange = [location.start, location.end];
      const key = range.join(":");
      if (seen.has(key)) continue;

      seen.add(key);
      ranges.push(range);
    }
  }

  return ranges;
}
