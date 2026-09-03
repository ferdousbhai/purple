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
import { STRUDEL_REFERENCE } from "./strudel-reference.ts";
import { DEFAULT_TRANSITION_CYCLES } from "./transitions.ts";

/**
 * What the MCP client is told about Purple before it calls anything. Purple
 * has no model of its own, so the studio cannot ask for the next section on
 * its own behalf: the agent holding these tools is the composer, and a set
 * only keeps evolving because these instructions say to keep it evolving.
 */
export const AGENT_INSTRUCTIONS =
  "Purple is a Strudel live-coding studio running in a browser tab the " +
  "listener has open. You are its composer: the tab writes no music on its " +
  "own.\n\n" +
  "Read get_strudel_reference before your first pattern. Purple only accepts " +
  "the notation and names listed there, and an unknown sound name is not an " +
  "error - it plays silence.\n\n" +
  "One section is two calls: set_pattern, then play.\n\n" +
  "Purple plays a set, not a pattern. Once something is playing, keep " +
  "composing: let the section run, then write the next one and play it to " +
  "crossfade in. Each section keeps the identity, groove, and tempo of the " +
  "one before it while the arrangement moves - a layer added or dropped, a " +
  "filter opened, a new section of the form. At the reference's 30 cycles a " +
  "minute, a four-minute section is about 120 cycles. Pace yourself so a " +
  "section plays for minutes rather than seconds; if you can sleep between " +
  "sections, sleep. Keep going until the listener stops you, and read " +
  "get_session when you are unsure whether the tab is still playing what you " +
  "last sent.\n\n" +
  "Browsers only allow sound after a click, so the first play after a page " +
  "load may need the listener to press PLAY in the tab once.";

export const NOT_CONNECTED_MESSAGE =
  "No Purple tab is connected. Ask the listener to open their Purple tab " +
  "and leave it open.";

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
      `playing, Purple crossfades to it over ${DEFAULT_TRANSITION_CYCLES} ` +
      "cycles and only returns once the crossfade has landed.",
    inputSchema: NO_INPUT,
  },
  {
    name: "stop",
    description: "Stop Purple playback and end the set.",
    inputSchema: NO_INPUT,
  },
];

export type AgentToolPlan =
  | { kind: "text"; text: string }
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
      return { kind: "text", text: STRUDEL_REFERENCE };
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
