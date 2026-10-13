import { describe, expect, it } from "vitest";
import {
  decodeAgentResponse,
  type AgentRequest,
} from "@purple/core/agent-link";
import { answerAgentRequest, type AgentLinkHandlers } from "./use-agent-link";
import { registerWebMcpTools, type ModelContextTool } from "./use-web-mcp";

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

async function respond(request: AgentRequest, handlers: AgentLinkHandlers) {
  return decodeAgentResponse(await answerAgentRequest(request, handlers));
}

describe("answerAgentRequest", () => {
  it("answers get_session with the studio snapshot", async () => {
    const reply = await respond(
      { id: "1", method: "get_session" },
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
      { id: "2", method: "set_pattern", code: "x", title: null },
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
      { id: "3", method: "play" },
      stubHandlers({
        play: async () => ({ ok: false, error: "Audio output is blocked." }),
      }),
    );
    expect(reply).toEqual({ id: "3", ok: false, error: "Audio output is blocked." });
  });

  it("turns a thrown handler failure into an error response", async () => {
    const reply = await respond(
      { id: "4", method: "set_pattern", code: "", title: null },
      stubHandlers({
        setPattern: async () => {
          throw new Error("The pattern is empty.");
        },
      }),
    );
    expect(reply).toEqual({ id: "4", ok: false, error: "The pattern is empty." });
  });
});

describe("registerWebMcpTools", () => {
  function register(handlers: AgentLinkHandlers) {
    const tools = new Map<string, ModelContextTool>();
    registerWebMcpTools(
      { registerTool: (tool) => void tools.set(tool.name, tool) },
      () => handlers,
      new AbortController().signal,
    );
    return tools;
  }

  it("registers the agent tools except share_pattern", () => {
    expect([...register(stubHandlers()).keys()]).toEqual([
      "get_strudel_reference",
      "get_session",
      "set_pattern",
      "play",
      "stop",
    ]);
  });

  it("runs calls through the studio handlers with the MCP result text", async () => {
    let applied: [string, string | null] | null = null;
    const tools = register(
      stubHandlers({
        setPattern: async (code, title) => {
          applied = [code, title];
          return { committed: true };
        },
      }),
    );
    const client = { signal: new AbortController().signal };
    expect(
      await tools.get("set_pattern")?.execute({ code: 's("hh*8")' }, client),
    ).toBe("Applied. Call play.");
    expect(applied).toEqual(['s("hh*8")', null]);
    expect(await tools.get("get_session")?.execute({}, client)).toContain("Four Floor");
    expect(tools.get("get_session")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.get("play")?.annotations?.readOnlyHint).toBe(false);
  });
});
