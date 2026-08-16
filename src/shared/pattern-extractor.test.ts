import { describe, it, expect } from "vitest";
import { extractPattern } from "@riff/core/pattern";

describe("extractPattern", () => {
  it("extracts code from a ```strudel block", () => {
    const text = "Here is a pattern:\n```strudel\ns(\"bd sd\")\n```";
    expect(extractPattern(text)).toBe('s("bd sd")');
  });

  it("extracts code from a ```js block", () => {
    const text = "Try this:\n```js\nnote(\"c3 e3 g3\")\n```";
    expect(extractPattern(text)).toBe('note("c3 e3 g3")');
  });

  it("extracts code from a ```javascript block", () => {
    const text = "```javascript\ns(\"hh*8\")\n```";
    expect(extractPattern(text)).toBe('s("hh*8")');
  });

  it("ignores bare ``` blocks (no lang tag)", () => {
    const text = "```\ns(\"bd sd hh cp\")\n```";
    expect(extractPattern(text)).toBeNull();
  });

  it("returns the LAST code block when multiple are present", () => {
    const text = [
      "First attempt:",
      "```strudel",
      "s(\"bd\")",
      "```",
      "Actually, try this instead:",
      "```strudel",
      "s(\"bd sd cp hh\")",
      "```",
    ].join("\n");
    expect(extractPattern(text)).toBe('s("bd sd cp hh")');
  });

  it("returns null when there are no code blocks", () => {
    expect(extractPattern("Just some text with no code blocks.")).toBeNull();
  });

  it("returns null for an empty code block", () => {
    const text = "```strudel\n```";
    expect(extractPattern(text)).toBeNull();
  });

  it("returns null for a code block with only whitespace", () => {
    const text = "```strudel\n   \n  \n```";
    expect(extractPattern(text)).toBeNull();
  });

  it("handles nested backticks in code (template literals)", () => {
    const text = [
      "```js",
      "const x = `hello ${name}`",
      "note(\"c3\")",
      "```",
    ].join("\n");
    const result = extractPattern(text);
    expect(result).toContain("const x = `hello ${name}`");
    expect(result).toContain('note("c3")');
  });

  it("extracts only the code, ignoring surrounding text", () => {
    const text =
      "Here is some explanation.\n```strudel\ns(\"bd sd\")\n```\nAnd some follow-up text.";
    expect(extractPattern(text)).toBe('s("bd sd")');
  });

  it("returns null when the closing fence is missing", () => {
    const text = "```strudel\ns(\"bd sd\")";
    expect(extractPattern(text)).toBeNull();
  });
});
