import { describe, expect, it } from "vitest";
import {
  decodeAgentResponse,
  encodeAgentHello,
  encodeAgentRequest,
} from "@purple/core/agent-link";
import { handleAgentFrame, type AgentLinkHandlers } from "./use-agent-link";

function stubHandlers(overrides: Partial<AgentLinkHandlers> = {}): AgentLinkHandlers {
  return {
    getSession: () => ({
      code: 's("bd*4")',
      title: "Four Floor",
      playbackState: "stopped",
      playbackError: null,
    }),
    setPattern: async () => ({ committed: true }),
    play: async () => ({ ok: true }),
    stop: () => {},
    ...overrides,
  };
}

async function respond(text: string, handlers: AgentLinkHandlers) {
  const reply = await handleAgentFrame(text, handlers);
  return reply === null ? null : decodeAgentResponse(reply);
}

describe("handleAgentFrame", () => {
  it("ignores frames that are not requests", async () => {
    expect(await handleAgentFrame(encodeAgentHello(), stubHandlers())).toBeNull();
    expect(await handleAgentFrame("not json", stubHandlers())).toBeNull();
  });

  it("answers get_session with the studio snapshot", async () => {
    const reply = await respond(
      encodeAgentRequest({ id: "1", method: "get_session" }),
      stubHandlers(),
    );
    expect(reply).toEqual({
      id: "1",
      ok: true,
      result: {
        code: 's("bd*4")',
        title: "Four Floor",
        playbackState: "stopped",
        playbackError: null,
      },
    });
  });

  it("relays set_pattern rejections as results, not errors", async () => {
    const reply = await respond(
      encodeAgentRequest({ id: "2", method: "set_pattern", code: "x", title: null }),
      stubHandlers({
        setPattern: async () => ({
          committed: false,
          problems: ["It fails to evaluate: x is not defined"],
        }),
      }),
    );
    expect(reply).toEqual({
      id: "2",
      ok: true,
      result: {
        committed: false,
        problems: ["It fails to evaluate: x is not defined"],
      },
    });
  });

  it("turns a failed play into an error response", async () => {
    const reply = await respond(
      encodeAgentRequest({ id: "3", method: "play" }),
      stubHandlers({
        play: async () => ({ ok: false, error: "Audio output is blocked." }),
      }),
    );
    expect(reply).toEqual({ id: "3", ok: false, error: "Audio output is blocked." });
  });

  it("turns a thrown handler failure into an error response", async () => {
    const reply = await respond(
      encodeAgentRequest({ id: "4", method: "set_pattern", code: "", title: null }),
      stubHandlers({
        setPattern: async () => {
          throw new Error("The pattern is empty.");
        },
      }),
    );
    expect(reply).toEqual({ id: "4", ok: false, error: "The pattern is empty." });
  });
});
