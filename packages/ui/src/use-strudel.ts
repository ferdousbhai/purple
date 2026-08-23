/* eslint-disable-next-line typescript/triple-slash-reference -- @strudel/web does not publish types; this local ambient declaration is the runtime contract. */
/// <reference path="./strudel-web.d.ts" />

import { useRef, useCallback, useEffect } from "react";
import type {
  StrudelHap,
  StrudelPattern,
  StrudelRepl,
} from "@strudel/web/web.mjs";
import type { EvalResult, SourceRange } from "@purple/core/types";
import {
  auditHapSounds,
  closestSoundNames,
  type ValidationProblem,
} from "@purple/core/validation";
import { loadPinnedSamples } from "./pinned-samples";
import {
  createSafeStrudelScope,
  evaluateSafeStrudelExpression,
  type SafeStrudelScope,
  type SafeStrudelValue,
} from "./safe-strudel";

type StrudelModule = typeof import("@strudel/web/web.mjs");

/** How many cycles of events the validation audit inspects. Four covers every
 * `<a b c d>` alternation the prompt examples use while staying instant. */
const VALIDATION_CYCLES = 4;

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
  const expressionScopeRef = useRef<SafeStrudelScope | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activePatternRef = useRef<StrudelPattern | null>(null);
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
      expressionScopeRef.current = null;
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
            console.error("[Strudel] Internal evaluation failed:", error);
          },
          // Manifests and audio bases are commit-addressed. The loader parses
          // data instead of executing it and ignores upstream `_base` fields.
          prebake: async () => {
            await loadPinnedSamples(strudel);
            // z_* chiptune synths (no network involved).
            strudel.registerZZFXSounds();
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

        installSchedulerCpm(strudel, repl);

        await strudel.initAudio();

        strudelRef.current = strudel;
        replRef.current = repl;
        expressionScopeRef.current = createSafeStrudelScope(strudel);
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
    const expressionScope = expressionScopeRef.current;
    if (!strudel || !repl || !expressionScope) {
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

      // Expression-only patterns have no labelled REPL state to clear, so the
      // historical hushBefore distinction is intentionally a no-op. setPattern
      // replaces the scheduler atomically for both direct plays and x-fades.
      void options.hushBefore;
      const pattern = evaluateSafeStrudelExpression(code, expressionScope);
      if (!isStrudelPattern(pattern)) {
        return {
          ok: false,
          error: "Pattern did not produce a playable Strudel expression.",
          kind: "evaluation",
        };
      }

      await repl.setPattern(pattern, true);
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

  /**
   * Audit `code` without touching playback: evaluate silently, query the
   * events it produces, and check every referenced sound name against the
   * engine's registry (Strudel plays SILENCE for unknown names, so evaluation
   * alone cannot catch them). Resolves with the problems found (empty = plays
   * correctly), or null when the engine is not initialized — the caller then
   * skips validation and play-time repair stays the safety net.
   */
  const validate = useCallback(async (
    code: string,
  ): Promise<ValidationProblem[] | null> => {
    // A send gesture usually kicked init off already; wait for it rather than
    // skipping. If init never started (or failed), validation is skipped.
    if (!replRef.current && initPromiseRef.current) {
      try {
        await initPromiseRef.current;
      } catch {
        return null;
      }
    }
    const strudel = strudelRef.current;
    const expressionScope = expressionScopeRef.current;
    if (!strudel || !replRef.current || !expressionScope) return null;

    try {
      // Interpretation builds a pattern without mutating the live scheduler.
      const pattern = evaluateSafeStrudelExpression(code, expressionScope);
      if (!isStrudelPattern(pattern)) {
        return [
          {
            kind: "evaluation",
            error: "Pattern did not produce a playable Strudel expression.",
          },
        ];
      }

      const haps = pattern.queryArc(0, VALIDATION_CYCLES);
      if (haps.length === 0) return [{ kind: "empty" }];

      const unknown = auditHapSounds(
        haps,
        (name) => strudel.getSound(name) != null,
      );
      if (unknown.length === 0) return [];

      const available = Object.keys(strudel.soundMap.get());
      return [
        {
          kind: "unknown-sounds",
          sounds: unknown.map((name) => ({
            name,
            suggestions: closestSoundNames(name, available),
          })),
        },
      ];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return [{ kind: "evaluation", error: message }];
    }
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
    validate,
    hush,
    isAudioReady,
    getSchedulerPosition,
    getActiveSourceRanges,
  };
}

function installSchedulerCpm(
  strudel: StrudelModule,
  repl: StrudelRepl,
): void {
  strudel.register("cpm", (cyclesPerMinute, pattern) => {
    const cpm = Number(cyclesPerMinute);
    const schedulerCps = Number(repl.scheduler.cps);
    if (
      !Number.isFinite(cpm) ||
      !Number.isFinite(schedulerCps) ||
      schedulerCps <= 0
    ) {
      throw new Error(".cpm() requires a finite tempo and a running scheduler.");
    }
    return pattern._fast(cpm / 60 / schedulerCps);
  });
}

/**
 * Strudel is untyped JavaScript, so the interpreted value is verified to carry
 * a pattern's query interface before it is treated as one.
 */
function isStrudelPattern(
  value: SafeStrudelValue,
): value is StrudelPattern {
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
