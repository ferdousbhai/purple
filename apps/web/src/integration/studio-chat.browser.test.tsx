import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { ChatMessage } from "@purple/core/types";
import {
  useStudioChat,
  type StudioChatBackend,
  type StudioChatState,
} from "@purple/ui/use-studio-chat";

const BROKEN_PATTERN = 's("bd*4")';
const FIXED_PATTERN = 's("bd sd")';

afterEach(cleanup);

describe("studio chat repair history", () => {
  it("keeps transient repair exchanges out of the visible and persisted transcript", async () => {
    const replies = [BROKEN_PATTERN, FIXED_PATTERN];
    const requests: ChatMessage[][] = [];
    const persisted: StudioChatState[] = [];
    const backend = {
      async stream(messages: readonly ChatMessage[], onDelta: (text: string) => void) {
        requests.push([...messages]);
        const reply = replies.shift();
        if (!reply) throw new Error("The test did not queue a model response.");
        onDelta(`\`\`\`js\n${reply}\n\`\`\``);
        return { promptTokens: 20, truncated: false };
      },
      async abortStream() {},
      async generateCompactionSummary() {
        return { ok: false as const, error: "Not needed by this test." };
      },
    } satisfies StudioChatBackend;
    const hook = renderHook(() =>
      useStudioChat(backend, {
        onStateChange: (state) => persisted.push(state),
      }),
    );

    await act(async () => {
      expect(await hook.result.current.sendMessage("Make a beat")).toBe(BROKEN_PATTERN);
    });
    const persistenceCountBeforeRepair = persisted.length;

    await act(async () => {
      expect(
        await hook.result.current.sendMessage("Repair the invalid pattern", {
          transient: true,
        }),
      ).toBe(FIXED_PATTERN);
    });

    expect(hook.result.current.messages).toHaveLength(2);
    expect(hook.result.current.messages.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(persisted).toHaveLength(persistenceCountBeforeRepair);
    expect(requests[1]).toHaveLength(3);
    expect(requests[1]?.at(-1)).toMatchObject({
      role: "user",
      content: "Repair the invalid pattern",
    });

    act(() => hook.result.current.replaceLastAssistantPattern(BROKEN_PATTERN, FIXED_PATTERN));

    expect(hook.result.current.messages).toHaveLength(2);
    expect(hook.result.current.messages.at(-1)?.content).toContain(FIXED_PATTERN);
    expect(hook.result.current.messages.at(-1)?.content).not.toContain(BROKEN_PATTERN);
    expect(persisted.at(-1)?.messages).toHaveLength(2);
  });
});
