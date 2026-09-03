import { describe, expect, it } from "vitest";
import {
  AGENT_TOOLS,
  formatAgentToolResult,
  planAgentToolCall,
} from "./agent-tools";

describe("planAgentToolCall", () => {
  it("answers the reference itself, without a studio round trip", () => {
    const plan = planAgentToolCall("get_strudel_reference", null);
    if (plan.kind !== "text") throw new Error("the reference needs no tab");
    expect(plan.text).toContain("## Mini-notation");
  });

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

  it("tells the agent a committed pattern is ready to play", () => {
    expect(
      formatAgentToolResult(
        { method: "set_pattern", code: "s()", title: null },
        { committed: true },
      ),
    ).toContain("Call play to hear it");
  });

  it("lists rejection problems for the agent to revise against", () => {
    const text = formatAgentToolResult(
      { method: "set_pattern", code: "s()", title: null },
      { committed: false, problems: ['"bd9" does not exist'] },
    );
    expect(text).toContain("rejected the pattern");
    expect(text).toContain('- "bd9" does not exist');
  });

  it("acknowledges transport controls tersely", () => {
    expect(formatAgentToolResult({ method: "play" }, {})).toBe("Playing.");
    expect(formatAgentToolResult({ method: "stop" }, {})).toBe("Stopped.");
  });
});
