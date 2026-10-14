/**
 * The agent-facing tool surface, shared by every MCP front end (the hosted
 * relay on the Worker and the optional local purple-mcp bridge) so the tools
 * an agent sees cannot drift between transports. Everything here is
 * dependency-free: catalog literals, argument decoding into AgentCall, and
 * result formatting for the agent.
 */

import type { AgentCall } from "./agent-link.ts";
import {
  DEFAULT_HANDLE,
  MAX_HANDLE_LENGTH,
  MAX_SHARED_TITLE_LENGTH,
} from "./shared-pattern.ts";
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
  "you. get_session shows what the tab is playing. When a section is a " +
  "keeper, share_pattern posts it to the public feed under your handle; " +
  "share the best ones, not every one.\n\n" +
  "If the first play is blocked, the listener must press PLAY in the tab once.";

/**
 * How each client registers Purple. Clients that speak MCP authorization
 * take the bare endpoint and get their pairing code from an Allow click in
 * the person's browser; the rest need the code in the URL.
 */
export const AGENT_CLIENTS = [
  {
    id: "claude",
    label: "CLAUDE CODE",
    needsPairingCode: false,
    command: (url: string) => `claude mcp add --transport http purple ${url}`,
  },
  {
    id: "codex",
    label: "CODEX",
    needsPairingCode: false,
    command: (url: string) => `codex mcp add purple --url ${url}`,
  },
  {
    id: "other",
    label: "OTHER",
    needsPairingCode: true,
    command: (url: string) => url,
  },
] as const;

export function agentEndpoint(origin: string, pairingCode: string | null): string {
  return pairingCode === null ? `${origin}/mcp` : `${origin}/mcp/${pairingCode}`;
}

/** How to register, for an agent that has no tab yet. */
export function pairingGuide(origin: string): string {
  const endpoint = agentEndpoint(origin, null);
  return [
    "Register once. The client opens this site in the person's browser for " +
      "one Allow click, which pairs it with that browser's Purple tab:",
    "",
    ...AGENT_CLIENTS.flatMap(({ command, needsPairingCode }) =>
      needsPairingCode ? [] : [`    ${command(endpoint)}`],
    ),
    "",
    "Streamable HTTP MCP with OAuth (dynamic registration, PKCE). A client " +
      "without OAuth support uses the pairing URL instead: the person opens " +
      `${origin}, presses AGENT then OTHER, and gives you ` +
      `${agentEndpoint(origin, "<pairing-code>")}.`,
  ].join("\n");
}

/** Repository-owned onboarding for an agent already in the listener's workspace. */
export function connectGuide(origin: string): string {
  const endpoint = agentEndpoint(origin, null);
  return `# Connect Purple in the current agent

Stay in the user's chosen agent and current conversation. Configure only this
harness in the current workspace. Preserve unrelated settings and inspect any
existing purple entry before changing it. Do not launch another agent.
Purple needs no local connector, package installation, or account.

1. Register ${endpoint} as a Streamable HTTP MCP server using this
   harness's native configuration, scoped to the current workspace.

   Codex: merge into the trusted workspace's .codex/config.toml:

   [mcp_servers.purple]
   url = "${endpoint}"
   enabled = true
   tool_timeout_sec = 180

   Then run codex mcp login purple from that workspace for browser authorization.
   The timeout lets play finish its crossfade before the client gives up.

   Claude Code: run in the current workspace:
   claude mcp add --scope local --transport http purple ${endpoint}
   Use /mcp to authenticate and reconnect Purple in this conversation.

   Other harnesses: consult their native HTTP MCP configuration and OAuth login.
   Do not guess a format or configure unrelated installed agents.

2. Let the listener approve Allow in their own browser. This selects that
   browser's studio tab. Never approve on their behalf, collect credentials in
   chat, or save OAuth tokens in workspace files. Keep the studio tab open.
   A client without OAuth support can use the private pairing URL from
   AGENT then OTHER at ${origin}; treat that URL as a secret.

3. Refresh tools using this harness's supported mechanism. If it cannot load a
   newly configured server in this conversation, report that setup is saved and
   give its supported reconnect or resume step. Do not claim tools are loaded
   merely because registration or authorization succeeded.

4. Call get_strudel_reference, then get_session to verify the live tab before
   reporting that Purple is connected. Compose with set_pattern and play when
   the listener asks for music. If audio is blocked, ask them to press PLAY once.
   Follow the server's instructions to keep a requested set evolving.
   share_pattern publishes publicly; use it only when the listener wants sharing.
`;
}

/** The site's llms.txt: everything an agent needs before it has a tab. */
export function agentGuide(origin: string): string {
  return [
    "# Purple",
    "",
    "> Strudel live-coding studio in the browser. Your MCP agent composes; " +
      "the tab plays. Nothing runs server-side.",
    "",
    "## Connect",
    "",
    `Follow [Connect in the current agent](${origin}/connect/guide) to configure this workspace and verify the live tab.`,
    "",
    pairingGuide(origin),
    "",
    "## Tools",
    "",
    `${AGENT_TOOLS.map(({ name }) => name).join(", ")}.`,
    "",
    AGENT_INSTRUCTIONS,
    "",
    "A browser agent with WebMCP can call the same tools (except " +
      "share_pattern) directly on the open studio page, with no pairing.",
    "",
    "## Endpoints",
    "",
    `- [MCP endpoint](${agentEndpoint(origin, null)}): Streamable HTTP MCP with OAuth`,
    `- [Studio](${origin}/): the tab that plays; registers WebMCP tools`,
    `- [Public patterns](${origin}/patterns): the shared feed, playable in the studio`,
    `- [Public patterns API](${origin}/api/patterns): JSON list, ?sort=fresh|top`,
    "",
    "## Optional",
    "",
    `- [Full guide](${origin}/llms-full.txt): this guide plus the Strudel reference`,
    "- [Source and offline bridge](https://github.com/ferdousbhai/purple): " +
      "purple-mcp runs the same tools over stdio",
    "",
  ].join("\n");
}

/** The site's llms-full.txt: the guide plus the reference get_strudel_reference returns. */
export function agentGuideFull(origin: string): string {
  return [agentGuide(origin), "# Strudel reference", "", STRUDEL_REFERENCE, ""].join(
    "\n",
  );
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
  {
    name: "share_pattern",
    description:
      "Publish the editor pattern to the public feed at /patterns. Returns its link.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: `Defaults to the editor title; at most ${MAX_SHARED_TITLE_LENGTH} characters.`,
        },
        handle: {
          type: "string",
          description:
            `Poster name shown on the feed, at most ${MAX_HANDLE_LENGTH} characters; ` +
            `${DEFAULT_HANDLE} by default.`,
        },
      },
      required: [],
    },
  },
];

type AgentToolPlan =
  | { kind: "text"; text: string }
  | { kind: "call"; call: AgentCall; timeoutMs: number }
  /** Read the session from the tab, then publish it; only the hosted relay can. */
  | {
      kind: "share";
      call: { method: "get_session" };
      timeoutMs: number;
      title: string | null;
      handle: string | null;
    };

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
    case "share_pattern":
      return {
        kind: "share",
        call: { method: "get_session" },
        timeoutMs: AGENT_CALL_TIMEOUTS_MS.get_session,
        title: jsonText(args?.get("title")),
        handle: jsonText(args?.get("handle")),
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

export const SHARE_NEEDS_RELAY_MESSAGE =
  "Sharing publishes through the hosted relay at soundspurple.com; the offline bridge cannot.";

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
