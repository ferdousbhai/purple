import { describe, expect, it } from "vitest";
import {
  parseGeneratedPatternTitle,
  patternFilename,
  validateGeneratedPatternTitle,
} from "@riff/core/pattern";

describe("patternFilename", () => {
  it("creates a portable Strudel filename", () => {
    expect(patternFilename("Chill 80 BPM Lo-Fi Beat"))
      .toBe("chill-80-bpm-lo-fi-beat.strudel");
  });

  it("has a stable fallback", () => {
    expect(patternFilename("🎛️"))
      .toBe("riff-pattern.strudel");
  });
});

describe("parseGeneratedPatternTitle", () => {
  it("parses a schema-constrained title response", () => {
    expect(parseGeneratedPatternTitle('{"title":"Midnight Acid Drive"}'))
      .toBe("Midnight Acid Drive");
  });

  it.each([
    "Midnight Acid Drive",
    '{"title":"Midnight Acid Drive","note":"extra"}',
    '{"name":"Midnight Acid Drive"}',
    "not json",
  ])("rejects responses outside the title schema", (value) => {
    expect(parseGeneratedPatternTitle(value)).toBeNull();
  });
});

describe("validateGeneratedPatternTitle", () => {
  it("accepts a concise plain-text title", () => {
    expect(validateGeneratedPatternTitle("  Midnight Acid Drive  "))
      .toBe("Midnight Acid Drive");
  });

  it.each([
    "",
    '"Midnight Acid Drive"',
    "Title:\nMidnight Acid Drive",
    "```Midnight Acid Drive```",
    "A".repeat(61),
  ])("rejects malformed model output", (value) => {
    expect(validateGeneratedPatternTitle(value)).toBeNull();
  });
});
