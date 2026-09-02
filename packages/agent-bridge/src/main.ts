/**
 * purple-mcp: an MCP stdio server that lets the visitor's local agent play
 * music in their Purple tab. The agent-facing tools mirror the studio's
 * agent-link methods; the Strudel reference is served from @purple/core so
 * the agent can learn the dialect before a tab is even connected.
 *
 * All logging goes to stderr: stdout carries the MCP protocol.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { AGENT_LINK_DEFAULT_PORT } from "@purple/core/agent-link";
import {
  isJsonString,
  jsonMembers,
  jsonText,
  parseJsonMembers,
  type JsonValue,
} from "@purple/core/json";
import { STRUDEL_REFERENCE } from "@purple/core/prompts";
import { createBrowserLink, type BrowserLink } from "./browser-link.ts";

/** play waits out a full crossfade; the others answer within one evaluation. */
const CALL_TIMEOUTS_MS = {
  get_session: 10_000,
  set_pattern: 30_000,
  play: 120_000,
  stop: 10_000,
} as const;

const NO_INPUT = { type: "object", properties: {} } as const;

const TOOLS: Tool[] = [
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

async function callTool(
  link: BrowserLink,
  name: string,
  args: ReadonlyMap<string, JsonValue> | null,
): Promise<string> {
  switch (name) {
    case "get_strudel_reference":
      return STRUDEL_REFERENCE;
    case "get_session": {
      const session = await link.call(
        { method: "get_session" },
        CALL_TIMEOUTS_MS.get_session,
      );
      return JSON.stringify(session, null, 2);
    }
    case "set_pattern": {
      const code = jsonText(args?.get("code"));
      if (code === null) throw new Error("set_pattern requires a code string.");
      const title = jsonText(args?.get("title"));
      const outcome = await link.call(
        { method: "set_pattern", code, title },
        CALL_TIMEOUTS_MS.set_pattern,
      );
      return describeSetPatternOutcome(outcome);
    }
    case "play":
      await link.call({ method: "play" }, CALL_TIMEOUTS_MS.play);
      return "Playing.";
    case "stop":
      await link.call({ method: "stop" }, CALL_TIMEOUTS_MS.stop);
      return "Stopped.";
    default:
      throw new Error(`Unknown tool: ${name}`);
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

export function resolvePort(
  argv: readonly string[],
  envPort: string | undefined,
): number {
  const flagIndex = argv.indexOf("--port");
  const raw = flagIndex >= 0 ? argv[flagIndex + 1] : envPort;
  if (raw === undefined) return AGENT_LINK_DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `"${raw}" is not a valid port. Pass --port with a number from 1 to 65535.`,
    );
  }
  return port;
}

export async function main(): Promise<void> {
  const port = resolvePort(process.argv.slice(2), process.env.PURPLE_MCP_PORT);
  const link = await createBrowserLink({
    port,
    log: (line) => console.error(`[purple-mcp] ${line}`),
  });
  console.error(
    `[purple-mcp] Waiting for the Purple tab on ws://127.0.0.1:${link.port}`,
  );

  const server = new Server(
    { name: "purple", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      // Arguments arrive over JSON-RPC; re-parse them at this boundary into
      // the JSON shapes the rest of the bridge branches on.
      const args = parseJsonMembers(
        JSON.stringify(request.params.arguments ?? {}),
      );
      const text = await callTool(link, request.params.name, args);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
}
