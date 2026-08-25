import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@purple/core/types";
import {
  withCurrentPatternContext,
  withRequestInstruction,
} from "./use-studio-chat";

describe("withRequestInstruction", () => {
  it("adds a request-only instruction to the latest user message", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "Earlier pattern" },
      { role: "user", content: "Add drums" },
    ];

    expect(withRequestInstruction(messages, "Comment every line.")).toEqual([
      messages[0],
      { role: "user", content: "Add drums\n\nComment every line." },
    ]);
    expect(messages[1]?.content).toBe("Add drums");
  });

  it("leaves the request unchanged when no instruction is active", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "Add drums" }];
    expect(withRequestInstruction(messages, undefined)).toEqual(messages);
  });
});

describe("withCurrentPatternContext", () => {
  it("adds changed editor code to only the outbound user message", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: '```strudel\ns("bd")\n```' },
      { role: "user", content: "Darken the bass" },
    ];

    const contextualized = withCurrentPatternContext(messages, 's("bd sd")');
    expect(contextualized.at(-1)?.content).toContain("Darken the bass");
    expect(contextualized.at(-1)?.content).toContain('s("bd sd")');
    expect(messages.at(-1)?.content).toBe("Darken the bass");
  });

  it("does not repeat editor code already present in model context", () => {
    const pattern = 's("bd sd")';
    const messages: ChatMessage[] = [
      { role: "assistant", content: `\`\`\`strudel\n${pattern}\n\`\`\`` },
      { role: "user", content: "Darken the bass" },
    ];

    expect(withCurrentPatternContext(messages, pattern)).toEqual(messages);
  });
});
