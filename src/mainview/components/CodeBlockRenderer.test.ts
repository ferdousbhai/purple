import { describe, expect, it } from "vitest";
import { visibleTextWithoutCodeBlocks } from "@purple/core/pattern";

describe("visibleTextWithoutCodeBlocks", () => {
  it("trims trailing whitespace left before a hidden streaming code block", () => {
    const text = "Try this pattern:\n\n```strudel\ns(\"bd sd\")";

    expect(visibleTextWithoutCodeBlocks(text)).toBe("Try this pattern:");
  });

  it("trims leading whitespace from visible prose", () => {
    expect(visibleTextWithoutCodeBlocks("\n  Ready to play.")).toBe(
      "Ready to play.",
    );
  });

  it("does not leave a blank line when a hidden code block comes first", () => {
    const text = '```strudel\ns("bd sd")\n```\n\nSlowed down to a deep crawl.';

    expect(visibleTextWithoutCodeBlocks(text)).toBe(
      "Slowed down to a deep crawl.",
    );
  });

  it("removes complete fenced code blocks from visible text", () => {
    const text = "Try this:\n```strudel\ns(\"bd\")\n```\nIt should work.";

    expect(visibleTextWithoutCodeBlocks(text)).toBe(
      "Try this:\n\nIt should work.",
    );
  });
});
