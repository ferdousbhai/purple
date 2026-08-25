import { isJsonNumber, jsonMembers, jsonText, type JsonValue } from "./json";
import { MAX_PROGRESSION_RUN_DURATION_MS } from "./progression-limits";

export { MAX_PROGRESSION_RUN_DURATION_MS } from "./progression-limits";

/** Musical time bounds for a model-planned progression. */
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

/** Apply the product ceiling at the boundary where a run is started. */
export function boundedProgressionRunDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 1) {
    return DEFAULT_PROGRESSION_RUN_DURATION_MS;
  }
  return Math.min(Math.floor(durationMs), MAX_PROGRESSION_RUN_DURATION_MS);
}

export interface PatternProgression {
  /** How many Strudel cycles this pattern should remain active. */
  afterCycles: number;
  /** A standalone English instruction for the next generation turn. */
  nextAction: string;
}

/** A progression tied to the pattern whose playback it schedules. */
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

export interface ProgressionRunDependencies {
  /** False after a user action or explicit stop supersedes this run. */
  isCurrent(): boolean;
  /** Resolve false when the musical-time wake is cancelled or fails. */
  wait(step: ProgressionStep): Promise<boolean>;
  /** Run the planned English action through the normal model turn. */
  generate(step: ProgressionStep): Promise<ProgressionTurn | null>;
  /** Land the generated pattern through the normal crossfade path. */
  transition(turn: ProgressionTurn): Promise<boolean>;
}

export type ProgressionRunResult = "complete" | "cancelled" | "failed";

/**
 * Continue model-planned music until a turn has no next plan, a step fails, or
 * ownership changes. The wait is supplied by the browser so this loop holds no
 * timer process or model request while a pattern is playing.
 */
export async function continueProgressionRun(
  initialStep: ProgressionStep,
  dependencies: ProgressionRunDependencies,
): Promise<ProgressionRunResult> {
  let step = initialStep;

  while (dependencies.isCurrent()) {
    if (!(await dependencies.wait(step)) || !dependencies.isCurrent()) {
      return "cancelled";
    }

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
