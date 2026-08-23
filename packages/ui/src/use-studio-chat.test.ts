import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@purple/core/types";
import { withRequestInstruction } from "./use-studio-chat";

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
