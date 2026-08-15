import { describe, expect, it } from "vitest";
import { parseTransitionSuggestions } from "./transition-suggestions";

const validResponse = JSON.stringify({
  suggestions: [
    { label: "Drift into dub", prompt: "Ease into spacious dub techno while preserving the pulse." },
    { label: "Lift into soul", prompt: "Move toward soulful house with brighter chords and a gentle lift." },
    { label: "Strip to ambience", prompt: "Dissolve the drums into warm Rhodes, tape haze, and soft sub-bass." },
  ],
});

describe("parseTransitionSuggestions", () => {
  it("parses three guided next-song options", () => {
    expect(parseTransitionSuggestions(validResponse)).toHaveLength(3);
  });

  it("accepts a detailed standalone generation prompt", () => {
    const detailed = JSON.parse(validResponse);
    detailed.suggestions[0].prompt = "A".repeat(300);
    expect(parseTransitionSuggestions(JSON.stringify(detailed))).toHaveLength(3);
  });

  it.each([
    "not json",
    JSON.stringify({ suggestions: [] }),
    JSON.stringify({ suggestions: [
      { label: "Same", prompt: "One" },
      { label: "Same", prompt: "Two" },
      { label: "Other", prompt: "Three" },
    ] }),
    JSON.stringify({ suggestions: [
      { label: "One", prompt: "First", extra: true },
      { label: "Two", prompt: "Second" },
      { label: "Three", prompt: "Third" },
    ] }),
  ])("rejects malformed suggestion output", (value) => {
    expect(parseTransitionSuggestions(value)).toBeNull();
  });
});
