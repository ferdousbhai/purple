import { describe, expect, it } from "vitest";
import { visibleTextWithoutCodeBlocks } from "./CodeBlockRenderer";

describe("visibleTextWithoutCodeBlocks", () => {
  it("trims trailing whitespace left before a hidden streaming code block", () => {
    const text = "Try this pattern:\n\n```strudel\ns(\"bd sd\")";

    expect(visibleTextWithoutCodeBlocks(text)).toBe("Try this pattern:");
  });

  it("preserves leading whitespace in visible text", () => {
    expect(visibleTextWithoutCodeBlocks("  Thinking out loud")).toBe(
      "  Thinking out loud",
    );
  });

  it("removes complete fenced code blocks from visible text", () => {
    const text = "Try this:\n```strudel\ns(\"bd\")\n```\nIt should work.";

    expect(visibleTextWithoutCodeBlocks(text)).toBe(
      "Try this:\n\nIt should work.",
    );
  });
});
