/**
 * purple-mcp: an MCP stdio server that lets a local agent play music in a
 * Purple tab without touching the network beyond 127.0.0.1. The hosted relay
 * on the website is the zero-install default; this bridge is the fully
 * offline alternative. The tool surface comes from @purple/core so both
 * front ends stay identical.
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
  AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  formatAgentToolResult,
  planAgentToolCall,
  SHARE_NEEDS_RELAY_MESSAGE,
} from "@purple/core/agent-tools";
import { parseJsonMembers } from "@purple/core/json";
import { createBrowserLink, type BrowserLink } from "./browser-link.ts";

const TOOLS: Tool[] = AGENT_TOOLS;

async function callTool(
  link: BrowserLink,
  name: string,
  argsText: string,
): Promise<string> {
  const plan = planAgentToolCall(name, parseJsonMembers(argsText));
  if (plan.kind === "text") return plan.text;
  if (plan.kind === "share") throw new Error(SHARE_NEEDS_RELAY_MESSAGE);
  const result = await link.call(plan.call, plan.timeoutMs);
  return formatAgentToolResult(plan.call, result);
}

function resolvePort(
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
    { capabilities: { tools: {} }, instructions: AGENT_INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      // Arguments arrive over JSON-RPC; re-parse them at this boundary into
      // the JSON shapes the shared tool planner branches on.
      const text = await callTool(
        link,
        request.params.name,
        JSON.stringify(request.params.arguments ?? {}),
      );
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
}
