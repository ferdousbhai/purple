/**
 * Wire protocol between the purple-mcp bridge (an MCP server running on the
 * visitor's computer) and the studio tab. Frames are JSON text over a
 * 127.0.0.1 WebSocket; this module is the single source of truth for their
 * shapes so the Node bridge and the browser client cannot drift apart.
 *
 * The bridge is the caller: it sends requests on behalf of the visitor's
 * agent and the studio answers. The studio opens the socket (a web page
 * cannot listen) and introduces itself with a hello frame.
 */

import {
  isJsonNumber,
  isJsonString,
  parseJsonMembers,
  type JsonValue,
} from "./json.ts";

export const AGENT_LINK_PROTOCOL = 1;
export const AGENT_LINK_DEFAULT_PORT = 7723;

/** A request minus its correlation id; what the bridge's callers supply. */
export type AgentCall =
  | { method: "get_session" }
  | { method: "set_pattern"; code: string; title: string | null }
  | { method: "play" }
  | { method: "stop" };

export type AgentRequest = AgentCall & { id: string };

export type AgentMethod = AgentCall["method"];

export type AgentResponse =
  | { id: string; ok: true; result: JsonValue }
  | { id: string; ok: false; error: string };

/** What the studio reports for get_session. */
export type AgentSessionSnapshot = {
  code: string;
  title: string;
  playbackState: string;
  playbackError: string | null;
};

/** What the studio reports for set_pattern. A rejected pattern is not an
 * error: the problems are feedback the agent revises against. */
export type SetPatternOutcome =
  | { committed: true }
  | { committed: false; problems: string[] };

export function encodeAgentHello(): string {
  return JSON.stringify({ type: "hello", protocol: AGENT_LINK_PROTOCOL });
}

export function decodeAgentHello(text: string): { protocol: number } | null {
  const fields = parseFrame(text, "hello");
  if (!fields) return null;
  const protocol = fields.get("protocol");
  return isJsonNumber(protocol) ? { protocol } : null;
}

export function encodeAgentRequest(request: AgentRequest): string {
  return JSON.stringify({ type: "request", ...request });
}

export function decodeAgentRequest(text: string): AgentRequest | null {
  const fields = parseFrame(text, "request");
  if (!fields) return null;
  const id = fields.get("id");
  const method = fields.get("method");
  if (!isJsonString(id) || !isJsonString(method)) return null;
  switch (method) {
    case "get_session":
    case "play":
    case "stop":
      return { id, method };
    case "set_pattern": {
      const code = fields.get("code");
      if (!isJsonString(code)) return null;
      const title = fields.get("title");
      return { id, method, code, title: isJsonString(title) ? title : null };
    }
    default:
      return null;
  }
}

export function encodeAgentResponse(response: AgentResponse): string {
  return JSON.stringify({ type: "response", ...response });
}

export function decodeAgentResponse(text: string): AgentResponse | null {
  const fields = parseFrame(text, "response");
  if (!fields) return null;
  const id = fields.get("id");
  if (!isJsonString(id)) return null;
  const ok = fields.get("ok");
  if (ok === true) {
    const result = fields.get("result");
    return result === undefined ? null : { id, ok: true, result };
  }
  if (ok !== false) return null;
  const error = fields.get("error");
  return isJsonString(error) ? { id, ok: false, error } : null;
}

function parseFrame(
  text: string,
  type: string,
): ReadonlyMap<string, JsonValue> | null {
  const fields = parseJsonMembers(text);
  return fields?.get("type") === type ? fields : null;
}
