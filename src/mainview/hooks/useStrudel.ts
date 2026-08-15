import { useRef, useCallback, useEffect } from "react";
import type { EvalResult, SourceRange } from "../../shared/types";
import { requireRunningAudioContext } from "../audio-activation";

interface StrudelLocation {
  start: number;
  end: number;
}

interface StrudelHap {
  context?: {
    locations?: StrudelLocation[];
  };
  isActive?: (time: number) => boolean;
}

interface StrudelPattern {
  queryArc: (
    begin: number,
    end: number,
    controls?: Record<string, unknown>,
  ) => StrudelHap[];
}

interface StrudelModule {
  evaluate: (
    code: string,
    autoplay: boolean,
    shouldHush?: boolean,
  ) => Promise<unknown>;
  getAudioContext: () => AudioContext;
  getCps?: () => unknown;
  getTime: () => number;
  hush: () => void;
  initAudio: () => Promise<void>;
  initStrudel: (options: {
    audioContext: AudioContext;
    onEvalError: (error: unknown) => void;
    prebake: () => unknown;
  }) => Promise<void>;
  samples: (source: string) => unknown;
}

export interface SchedulerPosition {
  cycle: number;
  cps: number;
}

export function useStrudel() {
  const strudelRef = useRef<StrudelModule | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activePatternRef = useRef<StrudelPattern | null>(null);
  const lastEvaluationErrorRef = useRef<unknown>(null);

  const acquireAudioContext = useCallback(() => {
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      return audioCtxRef.current;
    }

    if (audioCtxRef.current?.state === "closed") {
      strudelRef.current = null;
      initPromiseRef.current = null;
      activePatternRef.current = null;
    }

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    console.log("[Strudel] AudioContext created, initial state:", ctx.state);
    return ctx;
  }, []);

  const init = useCallback(
    async (ctx: AudioContext) => {
      if (strudelRef.current) return;
      if (initPromiseRef.current) return initPromiseRef.current;

      const promise = (async () => {
        console.log("[Strudel] Starting init...");
        const strudel = (await import("@strudel/web/web.mjs")) as StrudelModule;
        console.log("[Strudel] Module imported");

        await strudel.initStrudel({
          audioContext: ctx,
          onEvalError: (error) => {
            lastEvaluationErrorRef.current = error;
          },
          prebake: () =>
            strudel.samples("github:tidalcycles/Dirt-Samples/master"),
        });
        console.log("[Strudel] initStrudel done");

        await strudel.initAudio();
        console.log("[Strudel] initAudio done");

        strudelRef.current = strudel;
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
    console.log("[Strudel] AudioContext active, state:", ctx.state);
  }, [acquireAudioContext, init]);

  const evaluate = useCallback(async (
    code: string,
    options: { hushBefore?: boolean } = {},
  ): Promise<EvalResult> => {
    const strudel = strudelRef.current;
    if (!strudel) {
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
      const pattern = await strudel.evaluate(
        code,
        true,
        options.hushBefore ?? true,
      );
      if (!isStrudelPattern(pattern)) {
        const evaluationError = lastEvaluationErrorRef.current;
        const message =
          evaluationError instanceof Error
            ? evaluationError.message
            : "Strudel could not evaluate this pattern.";
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
    const cps = Number(strudel.getCps?.());
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
          _cps: strudel.getCps?.(),
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

function isStrudelPattern(value: unknown): value is StrudelPattern {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryArc" in value &&
    typeof value.queryArc === "function"
  );
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
