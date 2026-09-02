/**
 * Browser client for the purple-mcp bridge: connects out to the bridge's
 * 127.0.0.1 WebSocket (a page cannot listen), answers its requests from the
 * studio's handlers, and keeps retrying quietly while agent mode is on so
 * the tab and the bridge can start in either order.
 */

import { useEffect, useRef, useState } from "react";
import {
  decodeAgentRequest,
  encodeAgentHello,
  encodeAgentResponse,
  type AgentRequest,
  type AgentSessionSnapshot,
  type SetPatternOutcome,
} from "@purple/core/agent-link";
import { errorMessage } from "@purple/core/error";
import type { JsonValue } from "@purple/core/json";

export type AgentPlayOutcome = { ok: true } | { ok: false; error: string };

export interface AgentLinkHandlers {
  getSession(): AgentSessionSnapshot;
  setPattern(code: string, title: string | null): Promise<SetPatternOutcome>;
  play(): Promise<AgentPlayOutcome>;
  stop(): void;
}

export type AgentLinkStatus = "off" | "connecting" | "connected";

const RECONNECT_DELAY_MS = 2_500;

/**
 * Answer one bridge frame: the encoded response to send back, or null for
 * frames that are not requests. A handler failure becomes an error response;
 * it never escapes to the socket layer.
 */
export async function handleAgentFrame(
  text: string,
  handlers: AgentLinkHandlers,
): Promise<string | null> {
  const request = decodeAgentRequest(text);
  if (!request) return null;
  try {
    const result = await dispatchAgentRequest(request, handlers);
    return encodeAgentResponse({ id: request.id, ok: true, result });
  } catch (cause) {
    return encodeAgentResponse({
      id: request.id,
      ok: false,
      error: errorMessage(cause),
    });
  }
}

async function dispatchAgentRequest(
  request: AgentRequest,
  handlers: AgentLinkHandlers,
): Promise<JsonValue> {
  switch (request.method) {
    case "get_session":
      return handlers.getSession();
    case "set_pattern":
      return handlers.setPattern(request.code, request.title);
    case "play": {
      const outcome = await handlers.play();
      if (!outcome.ok) throw new Error(outcome.error);
      return { playing: true };
    }
    case "stop":
      handlers.stop();
      return { stopped: true };
  }
}

export function useAgentLink(options: {
  enabled: boolean;
  /** ws:// or wss:// endpoint: the hosted relay, or a local bridge. */
  url: string;
  handlers: AgentLinkHandlers;
}): AgentLinkStatus {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(options.handlers);
  handlersRef.current = options.handlers;

  useEffect(() => {
    if (!options.enabled) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      const candidate = new WebSocket(options.url);
      socket = candidate;
      candidate.onopen = () => {
        candidate.send(encodeAgentHello());
        setConnected(true);
      };
      candidate.onmessage = (event) => {
        // The bridge only sends text frames; anything else stringifies into
        // a frame the decoder rejects.
        void handleAgentFrame(String(event.data), handlersRef.current).then((reply) => {
          if (reply !== null && candidate.readyState === WebSocket.OPEN) {
            candidate.send(reply);
          }
        });
      };
      candidate.onclose = () => {
        if (disposed) return;
        setConnected(false);
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      setConnected(false);
      socket?.close();
    };
  }, [options.enabled, options.url]);

  if (!options.enabled) return "off";
  return connected ? "connected" : "connecting";
}
