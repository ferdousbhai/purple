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
  "Purple is a Strudel studio in the listener's browser tab. You compose; " +
  "the tab only plays.\n\n" +
  "Read get_strudel_reference first: only the names listed there work, and " +
  "an unknown sound plays silence with no error.\n\n" +
  "A section is set_pattern, then play. Play a set, not a loop: once music " +
  "is playing, keep writing the next section and play it to crossfade in, " +
  "keeping one tempo (a crossfade plays both sections at once) and the " +
  "groove while the arrangement moves. Let each " +
  "section run for minutes (at 30 cpm, four minutes is about 120 cycles), " +
  "sleep between sections if you can, and continue until the listener stops " +
  "you. get_session shows what the tab is playing.\n\n" +
  "If the first play is blocked, the listener must press PLAY in the tab once.";

/** How each client registers the endpoint; the raw URL always works too. */
export const AGENT_CLIENTS = [
  {
    id: "claude",
    label: "CLAUDE CODE",
    command: (url: string) => `claude mcp add --transport http purple ${url}`,
  },
  {
    id: "codex",
    label: "CODEX",
    command: (url: string) => `codex mcp add purple --url ${url}`,
  },
  { id: "other", label: "OTHER", command: (url: string) => url },
] as const;

/** Where the pairing code comes from and how to register it. */
export function pairingGuide(origin: string): string {
  const url = `${origin}/mcp/<pairing-code>`;
  return [
    "Each open Purple tab mints a private pairing code, shown under AGENT. " +
      `Ask the person to open ${origin}, press AGENT, and give you the code. ` +
      "Register once:",
    "",
    ...AGENT_CLIENTS.flatMap(({ command }) =>
      command(url) === url ? [] : [`    ${command(url)}`],
    ),
    "",
    "Streamable HTTP MCP, POST only. Any MCP client can use the URL.",
  ].join("\n");
}

/** The site's llms.txt: everything an agent needs before it has a tab. */
export function agentGuide(origin: string): string {
  return [
    "# Purple",
    "",
    "Strudel live-coding studio in the browser. Your MCP agent composes; the " +
      "tab plays. Nothing runs server-side.",
    "",
    "## Connect",
    "",
    pairingGuide(origin),
    "",
    "## Tools",
    "",
    `${AGENT_TOOLS.map(({ name }) => name).join(", ")}.`,
    "",
    AGENT_INSTRUCTIONS,
    "",
    `Public patterns: ${origin}/patterns`,
    "Source and offline bridge: https://github.com/ferdousbhai/purple",
    "",
  ].join("\n");
}

export const NOT_CONNECTED_MESSAGE =
  "No Purple tab is connected. Ask the listener to open Purple and keep the tab open.";

/** play waits out a full crossfade; the others answer within one evaluation. */
const AGENT_CALL_TIMEOUTS_MS = {
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

type AgentToolDefinition = {
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
      "The notation and names Purple accepts. Read before your first pattern.",
    inputSchema: NO_INPUT,
  },
  {
    name: "get_session",
    description: "Editor code, title, and playback state.",
    inputSchema: NO_INPUT,
  },
  {
    name: "set_pattern",
    description:
      "Replace the editor pattern. Validated against the sound registry; " +
      "on problems, fix and retry. Then call play.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "One complete Strudel expression.",
        },
        title: {
          type: "string",
          description: "Optional, at most 60 characters.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "play",
    description:
      "Play the editor pattern. If music is playing, crossfades over " +
      `${DEFAULT_TRANSITION_CYCLES} cycles and returns when done.`,
    inputSchema: NO_INPUT,
  },
  {
    name: "stop",
    description: "Stop playback.",
    inputSchema: NO_INPUT,
  },
];

type AgentToolPlan =
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
    return "Applied. Call play.";
  }
  const problems = fields?.get("problems");
  const lines = Array.isArray(problems) ? problems.filter(isJsonString) : [];
  return [
    "Purple rejected the pattern. Fix these and call set_pattern again:",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}
