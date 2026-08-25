import { describe, expect, it } from "vitest";
import {
  EXPLANATORY_STYLE_INSTRUCTION,
  REPAIR_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  withExplanatoryStyle,
} from "./prompts";

describe("generation and repair context", () => {
  it("grounds both tasks while keeping creative guidance out of repairs", () => {
    expect(SYSTEM_PROMPT).toContain("## Sample palette");
    expect(REPAIR_SYSTEM_PROMPT).toContain("## Sample palette");
    expect(SYSTEM_PROMPT).toContain("Aim for song-like arrangements");
    expect(REPAIR_SYSTEM_PROMPT).not.toContain("Aim for song-like arrangements");
    expect(REPAIR_SYSTEM_PROMPT).toContain("changing only what the reported");
  });
});

describe("withExplanatoryStyle", () => {
  it("adds the explanatory requirement when enabled", () => {
    const prompt = withExplanatoryStyle("Make house music", true);
    expect(prompt).toContain("Make house music");
    expect(prompt).toContain(EXPLANATORY_STYLE_INSTRUCTION);
    expect(prompt).toContain("every non-empty code line");
  });

  it("leaves the prompt alone when disabled", () => {
    expect(withExplanatoryStyle("Make house music", false)).toBe(
      "Make house music",
    );
  });
});
