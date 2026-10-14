import { describe, expect, it } from "vitest";
import {
  AGENT_TOOLS,
  agentGuide,
  agentGuideFull,
  connectGuide,
  formatAgentToolResult,
  planAgentToolCall,
} from "./agent-tools";

describe("agentGuide", () => {
  it("carries every client command, tool name, and the instructions", () => {
    const guide = agentGuide("https://soundspurple.com");
    expect(guide).toContain(
      "claude mcp add --transport http purple https://soundspurple.com/mcp\n",
    );
    expect(guide).toContain("codex mcp add purple --url https://soundspurple.com/mcp\n");
    expect(guide).toContain("https://soundspurple.com/mcp/<pairing-code>");
    for (const { name } of AGENT_TOOLS) expect(guide).toContain(name);
    expect(guide).toContain("Play a set, not a loop");
  });

  it("follows the llms.txt shape and links the full guide", () => {
    const guide = agentGuide("https://soundspurple.com");
    expect(guide.startsWith("# Purple\n\n> ")).toBe(true);
    expect(guide).toContain("- [MCP endpoint](https://soundspurple.com/mcp): ");
    expect(guide).toContain("(https://soundspurple.com/llms-full.txt)");
    const full = agentGuideFull("https://soundspurple.com");
    expect(full.startsWith(guide)).toBe(true);
    expect(full).toContain("## Mini-notation");
  });
});

describe("connectGuide", () => {
  it("scopes setup to the current harness and verifies a live tab", () => {
    const origin = "https://preview.example";
    const guide = connectGuide(origin);
    expect(agentGuide(origin)).toContain(`${origin}/connect/guide`);
    expect(guide).toContain(`url = "${origin}/mcp"`);
    expect(guide).toContain(`claude mcp add --scope local --transport http purple ${origin}/mcp`);
    expect(guide).toContain("codex mcp login purple");
    expect(guide).toContain("Do not launch another agent");
    expect(guide).toContain("get_session to verify the live tab");
    expect(guide).toContain("Never approve on their behalf");
  });
});

describe("planAgentToolCall", () => {
  it("plans parameterless calls with their timeouts", () => {
    expect(planAgentToolCall("play", null)).toEqual({
      kind: "call",
      call: { method: "play" },
      timeoutMs: 120_000,
    });
  });

  it("decodes set_pattern arguments and defaults the title", () => {
    expect(
      planAgentToolCall("set_pattern", new Map([["code", 's("bd*4")']])),
    ).toEqual({
      kind: "call",
      call: { method: "set_pattern", code: 's("bd*4")', title: null },
      timeoutMs: 30_000,
    });
  });

  it("rejects set_pattern without a code string and unknown tools", () => {
    expect(() => planAgentToolCall("set_pattern", null)).toThrow(
      "requires a code string",
    );
    expect(() => planAgentToolCall("make_coffee", null)).toThrow("Unknown tool");
  });

  it("plans share_pattern as a session read followed by a publish", () => {
    expect(
      planAgentToolCall("share_pattern", new Map([["handle", "dj_anon"]])),
    ).toEqual({
      kind: "share",
      call: { method: "get_session" },
      timeoutMs: 10_000,
      title: null,
      handle: "dj_anon",
    });
  });

  it("covers every tool in the catalog", () => {
    for (const tool of AGENT_TOOLS) {
      const args =
        tool.name === "set_pattern" ? new Map([["code", "s()"]]) : null;
      expect(() => planAgentToolCall(tool.name, args)).not.toThrow();
    }
  });
});

describe("formatAgentToolResult", () => {
  it("renders the session snapshot as JSON", () => {
    const text = formatAgentToolResult(
      { method: "get_session" },
      { code: 's("bd")', playbackState: "stopped" },
    );
    expect(JSON.parse(text)).toEqual({ code: 's("bd")', playbackState: "stopped" });
  });

  it("lists rejection problems for the agent to revise against", () => {
    const text = formatAgentToolResult(
      { method: "set_pattern", code: "s()", title: null },
      { committed: false, problems: ['"bd9" does not exist'] },
    );
    expect(text).toContain("rejected the pattern");
    expect(text).toContain('- "bd9" does not exist');
  });
});
