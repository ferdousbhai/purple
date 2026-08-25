import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { COMPACTION_WARNING_TOKENS } from "@purple/core/compaction";
import type { ChatMessage } from "@purple/core/types";
import {
  useStudioChat,
  type StudioChatBackend,
  type StudioChatState,
} from "@purple/ui/use-studio-chat";

const BROKEN_PATTERN = 's("bd*4")';
const FIXED_PATTERN = 's("bd sd")';

afterEach(cleanup);

function testBackend(options: {
  replies?: string[];
  promptTokens?: Array<number | null>;
  requests?: ChatMessage[][];
} = {}): StudioChatBackend {
  return {
    async stream(messages, callbacks) {
      options.requests?.push([...messages]);
      const pattern = options.replies?.shift();
      if (!pattern) throw new Error("The test did not queue a model response.");
      callbacks.onPatternDelta(pattern);
      callbacks.onPatternComplete(pattern);
      const promptTokens = options.promptTokens?.shift();
      return {
        turn: {
          pattern,
          progression: null,
          title: "Test pattern",
          suggestions: [],
          explanation: "A test groove.",
        },
        promptTokens: promptTokens === undefined ? 20 : promptTokens,
      };
    },
    async abortStream() {},
    async generateCompactionSummary() {
      return { ok: false, error: "Not needed by this test." };
    },
  };
}

describe("studio chat repair history", () => {
  it("replaces a repaired pattern in the visible and persisted transcript", async () => {
    const replies = [BROKEN_PATTERN];
    const requests: ChatMessage[][] = [];
    const persisted: StudioChatState[] = [];
    const backend = testBackend({ replies, requests });
    const hook = renderHook(() =>
      useStudioChat(backend, {
        onStateChange: (state) => persisted.push(state),
      }),
    );

    await act(async () => {
      expect((await hook.result.current.sendMessage("Make a beat"))?.pattern).toBe(
        BROKEN_PATTERN,
      );
    });
    expect(hook.result.current.messages).toHaveLength(2);
    expect(hook.result.current.messages.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(requests).toHaveLength(1);

    act(() => hook.result.current.replaceLastAssistantPattern(BROKEN_PATTERN, FIXED_PATTERN));

    expect(hook.result.current.messages).toHaveLength(2);
    expect(hook.result.current.messages.at(-1)?.content).toContain(FIXED_PATTERN);
    expect(hook.result.current.messages.at(-1)?.content).not.toContain(BROKEN_PATTERN);
    expect(persisted.at(-1)?.messages).toHaveLength(2);
  });

  it("updates compacted pattern memory when a covered repair lands", () => {
    const persisted: StudioChatState[] = [];
    const hook = renderHook(() =>
      useStudioChat(testBackend(), {
        initialState: {
          messages: [
            { role: "user", content: "Make a beat" },
            {
              role: "assistant",
              content: `\`\`\`strudel\n${BROKEN_PATTERN}\n\`\`\``,
            },
          ],
          artifact: {
            summary: "A drum pattern.",
            latestPattern: BROKEN_PATTERN,
          },
          coveredCount: 2,
        },
        onStateChange: (state) => persisted.push(state),
      }),
    );

    act(() =>
      hook.result.current.replaceLastAssistantPattern(
        BROKEN_PATTERN,
        FIXED_PATTERN,
      ),
    );

    expect(persisted.at(-1)?.artifact?.latestPattern).toBe(FIXED_PATTERN);
  });

  it("clears a stale token warning when the latest response omits usage", async () => {
    const replies = [BROKEN_PATTERN, FIXED_PATTERN];
    const promptTokens = [COMPACTION_WARNING_TOKENS, null];
    const backend = testBackend({ replies, promptTokens });
    const hook = renderHook(() => useStudioChat(backend));

    await act(async () => {
      await hook.result.current.sendMessage("Make a beat");
    });
    expect(hook.result.current.suggestNewSession).toBe(true);

    await act(async () => {
      await hook.result.current.sendMessage("Change the beat");
    });
    expect(hook.result.current.suggestNewSession).toBe(false);
  });
});
