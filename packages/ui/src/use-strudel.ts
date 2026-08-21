/// <reference path="./strudel-web.d.ts" />

import { useRef, useCallback, useEffect } from "react";
import type {
  StrudelHap,
  StrudelPattern,
  StrudelRepl,
} from "@strudel/web/web.mjs";
import type { EvalResult, SourceRange } from "@purple/core/types";

type StrudelModule = typeof import("@strudel/web/web.mjs");

export interface SchedulerPosition {
  cycle: number;
  cps: number;
}

export interface StrudelAudioOptions {
  /**
   * Ensure `context` may produce sound, resuming it if needed. Called inside
   * the user gesture — before the hook's first await, so the browser's user
   * activation is preserved — and again after Strudel initializes. Throw to
   * fail activation with a user-facing message.
   *
   * The default resumes the context and verifies it reports `running`. Hosts
   * with engine quirks inject their own: the desktop passes its WebKitGTK
   * implementation, which also primes the output with a silent buffer.
   */
  ensureRunningContext?: (context: AudioContext) => Promise<void>;
}

async function defaultEnsureRunningContext(context: AudioContext): Promise<void> {
  const state = String(context.state);
  if (state === "closed") {
    throw new Error("Audio output is closed. Reload Purple and try again.");
  }
  if (state !== "running") await context.resume();
  const resumedState = String(context.state);
  if (resumedState !== "running") {
    throw new Error(
      `Audio output is blocked (${resumedState}). Click Play to enable sound.`,
    );
  }
}

export function useStrudel(options: StrudelAudioOptions = {}) {
  const strudelRef = useRef<StrudelModule | null>(null);
  const replRef = useRef<StrudelRepl | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activePatternRef = useRef<StrudelPattern | null>(null);
  const lastEvaluationErrorRef = useRef<Error | null>(null);
  // A ref keeps activate() stable even when the caller passes a fresh options
  // object each render.
  const ensureRunningRef = useRef(defaultEnsureRunningContext);
  ensureRunningRef.current =
    options.ensureRunningContext ?? defaultEnsureRunningContext;

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
          // defaultPrebake() registers synths only, so every sample bank has
          // to be loaded explicitly. These mirror the packs the official
          // strudel.cc REPL prebakes (manifests are small; sample audio is
          // fetched lazily on first trigger): Dirt-Samples for the classic
          // names, tidal-drum-machines so `bank("RolandTR909")` etc. resolve,
          // and piano for the docs' default melodic sound.
          prebake: async () => {
            const doughSamples =
              "https://raw.githubusercontent.com/felixroos/dough-samples/main";
            await Promise.all([
              strudel.samples("github:tidalcycles/Dirt-Samples/master"),
              strudel.samples(`${doughSamples}/tidal-drum-machines.json`),
              strudel.samples(`${doughSamples}/piano.json`),
              // gm_* General MIDI instruments. Dynamically imported because a
              // static import breaks SSR builds (soundfont2 touches `window`).
              import("@strudel/soundfonts").then(({ registerSoundfonts }) =>
                registerSoundfonts(),
              ),
            ]);
            // z_* chiptune synths (no network involved).
            strudel.registerZZFXSounds();
            // Friendly bank names ("tr909" -> "RolandTR909"), as on strudel.cc.
            await strudel.aliasBank(
              "https://raw.githubusercontent.com/todepond/samples/main/tidal-drum-machines-alias.json",
            );
            // Dirt-Samples names these ho/cp/rm, but the model vocabulary
            // (and Strudel's own default prebake) says oh/clap/rim; the
            // drum-machine pack only registers prefixed names
            // (RolandTR909_oh), so without the aliases bare oh/clap/rim hits
            // are silently dropped.
            strudel.soundAlias("ho", "oh");
            strudel.soundAlias("cp", "clap");
            strudel.soundAlias("rm", "rim");
          },
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

  // Call from a click or key handler. ensureRunningContext invokes resume()
  // before its first await, preserving the browser's user activation.
  const activate = useCallback(async () => {
    const ctx = acquireAudioContext();
    await ensureRunningRef.current(ctx);
    await init(ctx);
    await ensureRunningRef.current(ctx);
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

  // Whether a user gesture has already unlocked audio output. Events that
  // arrive outside a gesture (MPRIS media keys) may only start playback when
  // this is true; activate() would otherwise leave the context suspended.
  const isAudioReady = useCallback(
    () =>
      audioCtxRef.current?.state === "running" && replRef.current !== null,
    [],
  );

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
          cyclist: "purple-highlight",
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
    isAudioReady,
    getSchedulerPosition,
    getActiveSourceRanges,
  };
}

function evaluationErrorMessage(error: Error | null): string {
  return error?.message ?? "Strudel could not evaluate this pattern.";
}

/**
 * Strudel is untyped JavaScript, so the value `evaluate` resolves with is
 * verified to carry a pattern's query interface before it is treated as one.
 */
function isStrudelPattern(
  value: StrudelPattern | undefined,
): value is StrudelPattern {
  return value != null && value.queryArc instanceof Function;
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
