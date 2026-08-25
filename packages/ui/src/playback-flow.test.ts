import { describe, expect, it } from "vitest";
import {
  GENERATED_PATTERN_ERROR,
  VALIDATION_UNAVAILABLE_ERROR,
  generatedPlaybackFailureMessage,
  hasUnappliedEditorChanges,
  isTransitionInfrastructureFailure,
  isValidatedGeneratedPattern,
  validationFailureMessage,
} from "./playback-flow";

describe("hasUnappliedEditorChanges", () => {
  it("reports edits that differ from the currently playing code", () => {
    expect(hasUnappliedEditorChanges("playing", 's("sd")', 's("bd")')).toBe(true);
  });

  it("does not report changes before playback starts or after they are applied", () => {
    expect(hasUnappliedEditorChanges("stopped", 's("sd")', 's("bd")')).toBe(false);
    expect(hasUnappliedEditorChanges("playing", 's("bd")', 's("bd")')).toBe(false);
  });
});

describe("generated pattern safety", () => {
  it("accepts only a candidate the live engine actually validated", () => {
    expect(
      isValidatedGeneratedPattern({ problems: [], validationSkipped: false }),
    ).toBe(true);
    expect(
      isValidatedGeneratedPattern({ problems: [], validationSkipped: true }),
    ).toBe(false);
    expect(
      isValidatedGeneratedPattern({
        problems: [{ kind: "evaluation", error: "bad pattern" }],
        validationSkipped: false,
      }),
    ).toBe(false);
  });

  it("owns validation and playback error wording", () => {
    expect(validationFailureMessage({ validationSkipped: true })).toBe(
      VALIDATION_UNAVAILABLE_ERROR,
    );
    expect(validationFailureMessage({ validationSkipped: false })).toBe(
      GENERATED_PATTERN_ERROR,
    );
    expect(
      generatedPlaybackFailureMessage({
        ok: false,
        kind: "evaluation",
        error: "engine detail",
      }),
    ).toBe(GENERATED_PATTERN_ERROR);
    expect(
      generatedPlaybackFailureMessage({
        ok: false,
        kind: "audio",
        error: "audio detail",
      }),
    ).toBe("audio detail");
    expect(generatedPlaybackFailureMessage({ ok: false, kind: "cancelled" })).toBeNull();
  });

  it("distinguishes wrapper failures from repairable candidate failures", () => {
    expect(
      isTransitionInfrastructureFailure({
        ok: false,
        kind: "evaluation",
        error: "wrapper failed",
        source: "transition",
      }),
    ).toBe(true);
    expect(
      isTransitionInfrastructureFailure({
        ok: false,
        kind: "evaluation",
        error: "candidate failed",
        source: "candidate",
      }),
    ).toBe(false);
  });
});
