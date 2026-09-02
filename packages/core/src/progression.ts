import { isJsonNumber, jsonMembers, jsonText, type JsonValue } from "./json.ts";
import { MAX_PROGRESSION_RUN_DURATION_MS } from "./progression-limits.ts";

export { MAX_PROGRESSION_RUN_DURATION_MS } from "./progression-limits.ts";

export const MIN_PROGRESSION_CYCLES = 32;
/** A safety ceiling, not a creative target. Long-form plans may need thousands. */
export const MAX_PROGRESSION_CYCLES = 4_096;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Runs are deliberately finite even when a tab is left open. */
export const DEFAULT_PROGRESSION_RUN_DURATION_MS = 5 * HOUR_MS;
export const PROGRESSION_RUN_DURATION_PRESETS_MS = [
  30 * MINUTE_MS,
  HOUR_MS,
  2 * HOUR_MS,
  3 * HOUR_MS,
  4 * HOUR_MS,
  5 * HOUR_MS,
  MAX_PROGRESSION_RUN_DURATION_MS,
] as const;

export function boundedProgressionRunDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 1) {
    return DEFAULT_PROGRESSION_RUN_DURATION_MS;
  }
  return Math.min(Math.floor(durationMs), MAX_PROGRESSION_RUN_DURATION_MS);
}

export interface PatternProgression {
  afterCycles: number;
  nextAction: string;
}

export interface ProgressionStep extends PatternProgression {
  pattern: string;
}

export interface ProgressionTurn {
  pattern: string;
  progression: PatternProgression | null;
}

/** Trust structured output only after applying Purple's tighter local bounds. */
export function validatePatternProgression(
  value: JsonValue | undefined,
): PatternProgression | null {
  const fields = value === undefined ? null : jsonMembers(value);
  if (fields === null || fields.size !== 2) return null;

  const afterCycles = fields.get("afterCycles");
  const rawNextAction = jsonText(fields.get("nextAction"));
  if (
    !isJsonNumber(afterCycles) ||
    !Number.isInteger(afterCycles) ||
    afterCycles < MIN_PROGRESSION_CYCLES ||
    afterCycles > MAX_PROGRESSION_CYCLES ||
    rawNextAction === null
  ) {
    return null;
  }

  const nextAction = rawNextAction.trim();
  if (
    !nextAction ||
    nextAction.length > 1_000 ||
    nextAction.includes("\n") ||
    nextAction.includes("```")
  ) {
    return null;
  }
  return { afterCycles, nextAction };
}

export function progressionStepFromTurn(
  turn: ProgressionTurn,
): ProgressionStep | null {
  return turn.progression === null
    ? null
    : { pattern: turn.pattern, ...turn.progression };
}

/** The direction a run sends when it engages on a pattern the model never
 * planned for: the default pattern, a restored session, a hand edit, or a
 * pattern opened from the public gallery. */
export const CONTINUE_PATTERN_ACTION =
  "Continue this pattern into its next section, keeping its identity, groove, and tempo while evolving the arrangement.";

/**
 * A first step for a run that engages without a model-supplied plan. The run
 * starts at its generate phase, so `afterCycles` only stands in until the
 * generated turn returns a real plan.
 */
export function continuePatternProgressionStep(
  pattern: string,
): ProgressionStep {
  return {
    pattern,
    afterCycles: MIN_PROGRESSION_CYCLES,
    nextAction: CONTINUE_PATTERN_ACTION,
  };
}

export interface ProgressionRunDependencies {
  /** False after a user action or explicit stop supersedes this run. */
  isCurrent(): boolean;
  /** Resolve false when the musical-time wake is cancelled or fails. */
  wait(step: ProgressionStep): Promise<boolean>;
  generate(step: ProgressionStep): Promise<ProgressionTurn | null>;
  transition(turn: ProgressionTurn): Promise<boolean>;
}

export type ProgressionRunResult = "complete" | "cancelled" | "failed";

/**
 * Where a run enters the loop. A run that inherits a model-supplied plan holds
 * the playing pattern first; a run that engages without one asks for the next
 * move straight away, then follows the plan that turn returns.
 */
export type ProgressionRunStartPhase = "wait" | "generate";

export interface ProgressionRunOptions {
  startPhase?: ProgressionRunStartPhase;
}

/**
 * Continue model-planned music until a turn has no next plan, a step fails, or
 * ownership changes. The wait is supplied by the browser so this loop holds no
 * timer process or model request while a pattern is playing.
 */
export async function continueProgressionRun(
  initialStep: ProgressionStep,
  dependencies: ProgressionRunDependencies,
  options: ProgressionRunOptions = {},
): Promise<ProgressionRunResult> {
  let step = initialStep;
  let holdCurrentPattern = options.startPhase !== "generate";

  while (dependencies.isCurrent()) {
    if (
      holdCurrentPattern &&
      (!(await dependencies.wait(step)) || !dependencies.isCurrent())
    ) {
      return "cancelled";
    }
    holdCurrentPattern = true;

    const turn = await dependencies.generate(step);
    if (!dependencies.isCurrent()) return "cancelled";
    if (turn === null) return "failed";

    if (!(await dependencies.transition(turn))) {
      return dependencies.isCurrent() ? "failed" : "cancelled";
    }
    if (!dependencies.isCurrent()) return "cancelled";

    const nextStep = progressionStepFromTurn(turn);
    if (nextStep === null) return "complete";
    step = nextStep;
  }

  return "cancelled";
}
