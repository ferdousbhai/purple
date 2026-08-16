import { describe, expect, it } from "vitest";
import {
  buildTransitionCode,
  extractPattern,
  generateRandomPrompt,
  parseTransitionSuggestions,
  patternFilename,
  visibleTextWithoutCodeBlocks,
} from "./index";

describe("@riff/core", () => {
  it("extracts only labelled Strudel blocks", () => {
    expect(extractPattern("```strudel\ns(\"bd\")\n```\nok")).toBe('s("bd")');
    expect(extractPattern("```\ns(\"bd\")\n```" )).toBeNull();
  });

  it("hides complete and streaming code blocks from assistant prose", () => {
    expect(visibleTextWithoutCodeBlocks('```strudel\ns("bd")')).toBe('');
    expect(visibleTextWithoutCodeBlocks('```strudel\ns("bd")\n```\nDusty drums.'))
      .toBe('Dusty drums.');
  });

  it("creates safe filenames", () => {
    expect(patternFilename("Café & Rain")).toBe("cafe-and-rain.strudel");
  });

  it("validates exactly three distinct suggestions", () => {
    const value = JSON.stringify({ suggestions: [
      { label: "Drift to dub", prompt: "A gentle dub continuation" },
      { label: "Lift the pulse", prompt: "A brighter house continuation" },
      { label: "Melt to ambient", prompt: "A spacious ambient continuation" },
    ] });
    expect(parseTransitionSuggestions(value)).toHaveLength(3);
  });

  it("builds deterministic crossfades and recipes", () => {
    expect(buildTransitionCode('s("bd")', 's("hh")', 4, 8)).toContain("cycle - 4");
    expect(generateRandomPrompt(() => 0)).toContain("76 BPM Lo-fi Jazzhop");
  });
});
