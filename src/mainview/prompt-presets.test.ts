import { describe, expect, it } from "vitest";
import {
  PROMPT_PRESETS,
  PROMPT_MODIFIERS,
  generateRandomPrompt,
} from "./prompt-presets";

describe("prompt-presets", () => {
  it("exports valid prompt presets", () => {
    expect(PROMPT_PRESETS.length).toBeGreaterThan(0);
    for (const preset of PROMPT_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.emoji).toBeTruthy();
      expect(preset.title).toBeTruthy();
      expect(preset.genre).toBeTruthy();
      expect(preset.prompt.length).toBeGreaterThan(10);
    }
  });

  it("exports valid prompt modifiers", () => {
    expect(PROMPT_MODIFIERS.length).toBeGreaterThan(0);
    for (const mod of PROMPT_MODIFIERS) {
      expect(mod.id).toBeTruthy();
      expect(mod.label).toBeTruthy();
      expect(mod.prompt.length).toBeGreaterThan(10);
    }
  });

  it("generates random valid music prompts", () => {
    for (let i = 0; i < 10; i++) {
      const prompt = generateRandomPrompt();
      expect(prompt).toMatch(/\d+ BPM/);
      expect(prompt.length).toBeGreaterThan(20);
    }
  });
});
