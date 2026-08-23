import { describe, expect, it } from "vitest";
import {
  EXPLANATORY_STYLE_INSTRUCTION,
  withExplanatoryStyle,
} from "./prompts";

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
