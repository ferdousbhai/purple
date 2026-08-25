import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROGRESSION_RUN_DURATION_MS,
  MAX_PROGRESSION_RUN_DURATION_MS,
  PROGRESSION_RUN_DURATION_PRESETS_MS,
  boundedProgressionRunDurationMs,
  continueProgressionRun,
  progressionStepFromTurn,
  validatePatternProgression,
  type ProgressionStep,
  type ProgressionTurn,
} from "./progression";

describe("progression run duration", () => {
  it("defaults to 30 minutes and extends hourly presets with ten hours", () => {
    expect(DEFAULT_PROGRESSION_RUN_DURATION_MS).toBe(30 * 60_000);
    expect(PROGRESSION_RUN_DURATION_PRESETS_MS).toEqual([
      30 * 60_000,
      60 * 60_000,
      2 * 60 * 60_000,
      3 * 60 * 60_000,
      4 * 60 * 60_000,
      5 * 60 * 60_000,
      10 * 60 * 60_000,
    ]);
  });

  it("caps custom durations at ten hours", () => {
    expect(boundedProgressionRunDurationMs(3 * 60 * 60_000)).toBe(
      3 * 60 * 60_000,
    );
    expect(boundedProgressionRunDurationMs(24 * 60 * 60_000)).toBe(
      MAX_PROGRESSION_RUN_DURATION_MS,
    );
    expect(boundedProgressionRunDurationMs(Number.NaN)).toBe(
      DEFAULT_PROGRESSION_RUN_DURATION_MS,
    );
    expect(boundedProgressionRunDurationMs(0.5)).toBe(
      DEFAULT_PROGRESSION_RUN_DURATION_MS,
    );
  });
});

const FIRST_STEP: ProgressionStep = {
  pattern: 's("bd*4")',
  afterCycles: 512,
  nextAction: "Open the hats and introduce a warm bass response",
};

describe("pattern progression metadata", () => {
  it("accepts bounded musical timing and a plain English action", () => {
    expect(validatePatternProgression({
      afterCycles: 512,
      nextAction: "  Open the filter gradually  ",
    })).toEqual({
      afterCycles: 512,
      nextAction: "Open the filter gradually",
    });
  });

  it("rejects unsafe or unreasonable plans", () => {
    expect(validatePatternProgression({
      afterCycles: 31,
      nextAction: "Move early",
    })).toBeNull();
    expect(validatePatternProgression({
      afterCycles: 4_097,
      nextAction: "Wait too long",
    })).toBeNull();
    expect(validatePatternProgression({
      afterCycles: 512.5,
      nextAction: "Move between cycles",
    })).toBeNull();
    expect(validatePatternProgression({
      afterCycles: 512,
      nextAction: "```strudel\nsilence\n```",
    })).toBeNull();
  });

  it("ties a valid plan to the generated pattern", () => {
    expect(progressionStepFromTurn({
      pattern: 's("hh*8")',
      progression: {
        afterCycles: 32,
        nextAction: "Bring the kick back with more weight",
      },
    })).toEqual({
      pattern: 's("hh*8")',
      afterCycles: 32,
      nextAction: "Bring the kick back with more weight",
    });
  });
});

describe("progression run", () => {
  it("waits, generates, and crossfades each planned step in order", async () => {
    let current = true;
    const events: string[] = [];
    const turns: ProgressionTurn[] = [
      {
        pattern: 's("hh*8")',
        progression: {
          afterCycles: 32,
          nextAction: "Resolve into a spacious final section",
        },
      },
      { pattern: 's("bd ~")', progression: null },
    ];

    await expect(continueProgressionRun(FIRST_STEP, {
      isCurrent: () => current,
      wait: async (step) => {
        events.push(`wait:${step.afterCycles}`);
        return true;
      },
      generate: async (step) => {
        events.push(`generate:${step.nextAction}`);
        return turns.shift() ?? null;
      },
      transition: async (turn) => {
        events.push(`xfade:${turn.pattern}`);
        return true;
      },
    })).resolves.toBe("complete");

    current = false;
    expect(events).toEqual([
      "wait:512",
      `generate:${FIRST_STEP.nextAction}`,
      'xfade:s("hh*8")',
      "wait:32",
      "generate:Resolve into a spacious final section",
      'xfade:s("bd ~")',
    ]);
  });

  it("does not generate after a scheduled wake loses ownership", async () => {
    let current = true;
    const generate = vi.fn<() => Promise<ProgressionTurn | null>>();

    await expect(continueProgressionRun(FIRST_STEP, {
      isCurrent: () => current,
      wait: async () => {
        current = false;
        return false;
      },
      generate,
      transition: vi.fn(),
    })).resolves.toBe("cancelled");

    expect(generate).not.toHaveBeenCalled();
  });

  it("stops after a failed generation instead of spinning", async () => {
    const transition = vi.fn();

    await expect(continueProgressionRun(FIRST_STEP, {
      isCurrent: () => true,
      wait: async () => true,
      generate: async () => null,
      transition,
    })).resolves.toBe("failed");

    expect(transition).not.toHaveBeenCalled();
  });
});
