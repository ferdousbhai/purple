/**
 * purple-mcp: an MCP stdio server that lets a local agent play music in a
 * Purple tab without touching the network beyond 127.0.0.1. The hosted relay
 * on the website is the zero-install default; this bridge is the fully
 * offline alternative. The MCP server and tool surface both come from
 * @purple/core, so the two front ends differ only in transport.
 *
 * All logging goes to stderr: stdout carries the MCP protocol.
 */

import { createInterface } from "node:readline";
import { AGENT_LINK_DEFAULT_PORT } from "@purple/core/agent-link";
import { errorMessage } from "@purple/core/error";
import type { JsonValue } from "@purple/core/json";
import {
  handleMcpMessage,
  MCP_PARSE_ERROR,
  type AgentCaller,
} from "@purple/core/mcp-server";
import { createBrowserLink } from "./browser-link.ts";

/** MCP over stdio is one JSON-RPC message per line in each direction. */
function send(message: JsonValue): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export async function main(): Promise<void> {
  // The tab always dials AGENT_LINK_DEFAULT_PORT in local mode, so the bridge
  // is only reachable there.
  const link = await createBrowserLink({
    port: AGENT_LINK_DEFAULT_PORT,
    log: (line) => console.error(`[purple-mcp] ${line}`),
  });
  console.error(
    `[purple-mcp] Waiting for the Purple tab on ws://127.0.0.1:${link.port}`,
  );

  const callAgent: AgentCaller = async (call, timeoutMs) => {
    try {
      return { ok: true, result: await link.call(call, timeoutMs) };
    } catch (cause) {
      return { ok: false, error: errorMessage(cause) };
    }
  };

  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    if (line.trim() === "") return;
    let message: JsonValue;
    try {
      message = JSON.parse(line);
    } catch {
      send(MCP_PARSE_ERROR);
      return;
    }
    // Messages are answered as they settle, not in order: a ping must not
    // wait behind a play that is crossfading for a minute.
    void handleMcpMessage(message, callAgent).then((reply) => {
      if (reply !== null) send(reply);
    });
  });

  // The listening WebSocket server keeps the event loop alive, so a client
  // that dies without signalling its child would leave an orphan holding the
  // port and every later launch would fail with EADDRINUSE. Close the link
  // and exit on EOF instead.
  input.once("close", () => {
    void link.close().finally(() => process.exit(0));
  });
}
