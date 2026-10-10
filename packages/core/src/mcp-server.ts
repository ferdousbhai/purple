/**
 * The MCP server both front ends speak: the hosted relay answers it over
 * Streamable HTTP and the purple-mcp bridge over stdio. It is a few JSON-RPC
 * methods over the shared tool surface, so it stays dependency-free and the
 * transports only differ in how a tool call reaches the tab.
 */

import type { AgentCall } from "./agent-link.ts";
import {
  AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  formatAgentToolResult,
  planAgentToolCall,
  SHARE_NEEDS_RELAY_MESSAGE,
} from "./agent-tools.ts";
import { errorMessage } from "./error.ts";
import {
  isJsonNumber,
  isJsonString,
  jsonMembers,
  jsonText,
  type JsonValue,
} from "./json.ts";
import {
  parseSharedPatternDraft,
  type SharedPatternDraft,
} from "./shared-pattern.ts";

const SUPPORTED_MCP_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const LATEST_MCP_VERSION = "2025-06-18";

export type AgentCallOutcome =
  | { ok: true; result: JsonValue }
  | { ok: false; error: string };

export type AgentCaller = (
  call: AgentCall,
  timeoutMs: number,
) => Promise<AgentCallOutcome>;

export type PatternPublisher = (
  draft: SharedPatternDraft,
) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;

/**
 * Answer one JSON-RPC message: the response value, or null for notifications,
 * which get no reply. Pure apart from the injected agent caller and publisher,
 * so tests can drive it without a transport. Without a publisher, sharing
 * explains that only the hosted relay can publish.
 */
export async function handleMcpMessage(
  message: JsonValue,
  callAgent: AgentCaller,
  publish: PatternPublisher | null = null,
): Promise<JsonValue | null> {
  const fields = jsonMembers(message);
  if (!fields || fields.get("jsonrpc") !== "2.0") {
    return rpcError(null, -32600, "Invalid request");
  }
  const method = jsonText(fields.get("method"));
  if (method === null) return rpcError(null, -32600, "Invalid request");

  const id = fields.get("id");
  const isNotification =
    id === undefined || (!isJsonString(id) && !isJsonNumber(id));
  if (method.startsWith("notifications/")) return null;
  if (isNotification) return null;

  const params = jsonMembers(fields.get("params") ?? null);
  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: negotiatedVersion(params),
        capabilities: { tools: {} },
        serverInfo: { name: "purple", version: "0.1.0" },
        instructions: AGENT_INSTRUCTIONS,
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: AGENT_TOOLS });
    case "tools/call":
      return callTool(id, params, callAgent, publish);
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** The reply to a message that is not JSON at all. */
export const MCP_PARSE_ERROR: JsonValue = rpcError(null, -32700, "Parse error");

async function callTool(
  id: JsonValue,
  params: ReadonlyMap<string, JsonValue> | null,
  callAgent: AgentCaller,
  publish: PatternPublisher | null,
): Promise<JsonValue> {
  const name = jsonText(params?.get("name"));
  if (name === null || !AGENT_TOOLS.some((tool) => tool.name === name)) {
    return rpcError(id, -32602, `Unknown tool: ${name ?? "(missing name)"}`);
  }
  const args = jsonMembers(params?.get("arguments") ?? null);
  try {
    const plan = planAgentToolCall(name, args);
    if (plan.kind === "text") return toolText(id, plan.text);
    if (plan.kind === "share") {
      if (publish === null) return toolText(id, SHARE_NEEDS_RELAY_MESSAGE, true);
      const session = await callAgent(plan.call, plan.timeoutMs);
      if (!session.ok) return toolText(id, session.error, true);
      const fields = jsonMembers(session.result);
      const draft = parseSharedPatternDraft({
        title: plan.title ?? jsonText(fields?.get("title")),
        code: jsonText(fields?.get("code")),
        handle: plan.handle,
      });
      if (draft === null) {
        return toolText(
          id,
          "Nothing publishable in the editor, or the title or handle is too long.",
          true,
        );
      }
      const published = await publish(draft);
      return published.ok
        ? toolText(id, `Published to the public feed: ${published.url}`)
        : toolText(id, published.error, true);
    }
    const outcome = await callAgent(plan.call, plan.timeoutMs);
    return outcome.ok
      ? toolText(id, formatAgentToolResult(plan.call, outcome.result))
      : toolText(id, outcome.error, true);
  } catch (cause) {
    return toolText(id, errorMessage(cause), true);
  }
}

function negotiatedVersion(
  params: ReadonlyMap<string, JsonValue> | null,
): string {
  const requested = jsonText(params?.get("protocolVersion"));
  return requested !== null && SUPPORTED_MCP_VERSIONS.includes(requested)
    ? requested
    : LATEST_MCP_VERSION;
}

function rpcResult(id: JsonValue, result: JsonValue): JsonValue {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonValue, code: number, text: string): JsonValue {
  return { jsonrpc: "2.0", id, error: { code, message: text } };
}

function toolText(id: JsonValue, text: string, isError = false): JsonValue {
  return rpcResult(id, {
    content: [{ type: "text", text }],
    isError,
  });
}
