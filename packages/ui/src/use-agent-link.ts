/**
 * Browser client for the agent link: the tab connects out to the relay (a
 * page cannot listen), answers the agent's requests from the studio's
 * handlers, and keeps retrying quietly so the tab and the agent can arrive
 * in either order.
 */

import { useEffect, useRef, useState } from "react";
import {
  decodeAgentRequest,
  encodeAgentHello,
  encodeAgentResponse,
  LINK_TAKEN_OVER_CODE,
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

const FIRST_RECONNECT_DELAY_MS = 2_500;
const MAX_RECONNECT_DELAY_MS = 30_000;

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

/** True once the agent is linked to this tab. */
export function useAgentLink(options: {
  /** ws:// or wss:// endpoint: the hosted relay, or a local bridge. */
  url: string;
  handlers: AgentLinkHandlers;
}): boolean {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(options.handlers);
  handlersRef.current = options.handlers;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let reconnectDelayMs = FIRST_RECONNECT_DELAY_MS;
    let disposed = false;
    let dormant = false;

    const retryLater = () => {
      reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
      // Back off toward half a minute: nothing is listening for most visits,
      // and a hosted relay that is down should not be dialled 1,400 times an
      // hour by every open tab.
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    };

    const connect = () => {
      if (document.hidden) {
        // A background tab cannot be pairing with anyone; wake on focus.
        dormant = true;
        return;
      }
      dormant = false;
      const candidate = new WebSocket(options.url);
      socket = candidate;
      candidate.onopen = () => {
        candidate.send(encodeAgentHello());
        reconnectDelayMs = FIRST_RECONNECT_DELAY_MS;
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
      candidate.onclose = (event) => {
        if (disposed) return;
        setConnected(false);
        if (event.code === LINK_TAKEN_OVER_CODE) {
          // Another tab of this browser claimed the link. Racing it back would
          // evict that tab in turn, forever; leave this one dormant instead.
          dormant = true;
          return;
        }
        retryLater();
      };
    };

    const wake = () => {
      if (disposed || document.hidden || !dormant) return;
      window.clearTimeout(reconnectTimer);
      reconnectDelayMs = FIRST_RECONNECT_DELAY_MS;
      connect();
    };

    connect();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      setConnected(false);
      socket?.close();
    };
  }, [options.url]);

  return connected;
}
