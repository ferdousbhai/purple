/**
 * WebMCP: the studio's agent tools registered on the page itself, so a
 * browser agent can compose in this tab without pairing through the relay.
 * The catalog, argument decoding, and result text come from
 * @purple/core/agent-tools and the calls run through the same handlers the
 * relay link uses, so both surfaces cannot drift apart.
 */

import { useEffect, useRef } from "react";
import {
  AGENT_TOOLS,
  formatAgentToolResult,
  planAgentToolCall,
} from "@purple/core/agent-tools";
import { jsonMembers, type JsonValue } from "@purple/core/json";
import { dispatchAgentCall, type AgentLinkHandlers } from "./use-agent-link";

// Local types for the W3C WebML CG draft; browsers without it skip the hook.
export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonValue;
  execute(input: JsonValue, client: { signal?: AbortSignal }): Promise<JsonValue>;
  annotations?: {
    readOnlyHint?: boolean;
    consequentialHint?: boolean;
    untrustedContentHint?: boolean;
  };
}

export interface ModelContext {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): void;
}

/** share_pattern needs the relay's per-code rate limit; the page's SHARE
 * button is the person's own Turnstile-gated path. */
const PAGE_TOOLS = AGENT_TOOLS.filter(({ name }) => name !== "share_pattern");
const READ_ONLY_TOOLS = new Set(["get_strudel_reference", "get_session"]);

type ModelContextHost = { modelContext?: ModelContext };

function modelContext(): ModelContext | null {
  // SAFETY: the DOM lib does not declare modelContext yet; it is read as an
  // optional member and only used once registerTool is present.
  const host = document as ModelContextHost;
  // SAFETY: as above, for the older Chrome previews that put it on navigator.
  const legacyHost = navigator as ModelContextHost;
  const mc = host.modelContext ?? legacyHost.modelContext;
  return mc?.registerTool ? mc : null;
}

/** Register the studio tools while the studio is mounted. */
export function useWebMcpTools(handlers: AgentLinkHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const mc = modelContext();
    if (!mc) return;
    const controller = new AbortController();
    registerWebMcpTools(mc, () => handlersRef.current, controller.signal);
    return () => controller.abort();
  }, []);
}

/** Register every page tool until `signal` aborts. */
export function registerWebMcpTools(
  mc: ModelContext,
  getHandlers: () => AgentLinkHandlers,
  signal: AbortSignal,
): void {
  for (const tool of PAGE_TOOLS) {
    try {
      mc.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: READ_ONLY_TOOLS.has(tool.name) },
          execute: async (input) => {
            const plan = planAgentToolCall(tool.name, jsonMembers(input));
            if (plan.kind === "text") return plan.text;
            if (plan.kind !== "call") throw new Error(`Unsupported tool: ${tool.name}`);
            const result = await dispatchAgentCall(plan.call, getHandlers());
            return formatAgentToolResult(plan.call, result);
          },
        },
        { signal },
      );
    } catch {
      // A duplicate name (another mount still registered) must not break the page.
    }
  }
}
