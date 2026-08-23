import { describe, expect, it } from "vitest";
import {
  hasUnappliedEditorChanges,
  resolveGeneratedPatternMode,
} from "./playback-flow";

describe("resolveGeneratedPatternMode", () => {
  it("stages ordinary prompts while music is playing", () => {
    expect(resolveGeneratedPatternMode("play", "playing")).toBe("stage");
  });

  it("plays ordinary prompts when playback is stopped", () => {
    expect(resolveGeneratedPatternMode("play", "stopped")).toBe("play");
  });

  it("keeps explicitly staged next moves staged", () => {
    expect(resolveGeneratedPatternMode("stage", "stopped")).toBe("stage");
  });
});

describe("hasUnappliedEditorChanges", () => {
  it("reports edits that differ from the currently playing code", () => {
    expect(hasUnappliedEditorChanges("playing", 's("sd")', 's("bd")')).toBe(true);
  });

  it("does not report changes before playback starts or after they are applied", () => {
    expect(hasUnappliedEditorChanges("stopped", 's("sd")', 's("bd")')).toBe(false);
    expect(hasUnappliedEditorChanges("playing", 's("bd")', 's("bd")')).toBe(false);
  });
});
