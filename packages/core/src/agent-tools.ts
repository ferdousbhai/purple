/**
 * The agent-facing tool surface, shared by every MCP front end (the hosted
 * relay on the Worker and the optional local purple-mcp bridge) so the tools
 * an agent sees cannot drift between transports. Everything here is
 * dependency-free: catalog literals, argument decoding into AgentCall, and
 * result formatting for the agent.
 */

import type { AgentCall } from "./agent-link.ts";
import {
  isJsonString,
  jsonMembers,
  jsonText,
  type JsonValue,
} from "./json.ts";

export const NOT_CONNECTED_MESSAGE =
  "No Purple tab is connected. Ask the user to open Purple in their browser, " +
  "choose LOCAL AGENT on the session panel, and keep the tab open.";

/** play waits out a full crossfade; the others answer within one evaluation. */
export const AGENT_CALL_TIMEOUTS_MS = {
  get_session: 10_000,
  set_pattern: 30_000,
  play: 120_000,
  stop: 10_000,
} satisfies { [method in AgentCall["method"]]: number };

// Type aliases (not interfaces) with no optional members, so the catalog is
// assignable to JsonValue and can travel in a tools/list result verbatim.
type AgentToolProperty = {
  type: "string";
  description: string;
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: { [name: string]: AgentToolProperty };
    required: string[];
  };
};

const NO_INPUT: AgentToolDefinition["inputSchema"] = {
  type: "object",
  properties: {},
  required: [],
};

export const AGENT_TOOLS: AgentToolDefinition[] = [
  {
    name: "get_strudel_reference",
    description:
      "The Strudel notation and function reference Purple patterns must stay " +
      "within. Read this before writing your first pattern.",
    inputSchema: NO_INPUT,
  },
  {
    name: "get_session",
    description:
      "Read the Purple studio session: the pattern code in the editor, its " +
      "title, and the playback state.",
    inputSchema: NO_INPUT,
  },
  {
    name: "set_pattern",
    description:
      "Replace the pattern in the Purple editor. The studio validates the " +
      "code against its sound registry first; if problems come back, revise " +
      "and call set_pattern again. Call play afterwards to hear it.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "A complete Strudel pattern expression.",
        },
        title: {
          type: "string",
          description: "Optional title for the pattern, at most 60 characters.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "play",
    description:
      "Play the pattern currently in the Purple editor. If music is already " +
      "playing, Purple crossfades to the new pattern. Browsers only allow " +
      "sound after a click, so the first play after a page load may ask the " +
      "user to press PLAY in the tab once.",
    inputSchema: NO_INPUT,
  },
  {
    name: "stop",
    description: "Stop Purple playback.",
    inputSchema: NO_INPUT,
  },
];

export type AgentToolPlan =
  | { kind: "reference" }
  | { kind: "call"; call: AgentCall; timeoutMs: number };

/**
 * Decode one tool invocation into what to do with it. Throws with an
 * agent-readable message for an unknown tool or unusable arguments.
 */
export function planAgentToolCall(
  name: string,
  args: ReadonlyMap<string, JsonValue> | null,
): AgentToolPlan {
  switch (name) {
    case "get_strudel_reference":
      return { kind: "reference" };
    case "get_session":
    case "play":
    case "stop":
      return {
        kind: "call",
        call: { method: name },
        timeoutMs: AGENT_CALL_TIMEOUTS_MS[name],
      };
    case "set_pattern": {
      const code = jsonText(args?.get("code"));
      if (code === null) throw new Error("set_pattern requires a code string.");
      const title = jsonText(args?.get("title"));
      return {
        kind: "call",
        call: { method: "set_pattern", code, title },
        timeoutMs: AGENT_CALL_TIMEOUTS_MS.set_pattern,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Turn a studio response into the text the agent reads. */
export function formatAgentToolResult(
  call: AgentCall,
  result: JsonValue,
): string {
  switch (call.method) {
    case "get_session":
      return JSON.stringify(result, null, 2);
    case "set_pattern":
      return describeSetPatternOutcome(result);
    case "play":
      return "Playing.";
    case "stop":
      return "Stopped.";
  }
}

function describeSetPatternOutcome(outcome: JsonValue): string {
  const fields = jsonMembers(outcome);
  if (fields?.get("committed") === true) {
    return "Pattern applied to the editor. Call play to hear it.";
  }
  const problems = fields?.get("problems");
  const lines = Array.isArray(problems) ? problems.filter(isJsonString) : [];
  return [
    "The studio rejected the pattern. Fix these problems and call set_pattern again:",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}
