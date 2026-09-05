/**
 * The studio side of the bridge: a WebSocket server bound to 127.0.0.1 that
 * one Purple tab connects to. MCP tool calls become requests forwarded to the
 * tab and are matched back to their responses by id. The newest tab wins, so
 * a reload or a second window replaces the old link instead of wedging it.
 */

import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
  AGENT_LINK_PROTOCOL,
  decodeAgentHello,
  decodeAgentResponse,
  encodeAgentRequest,
  LINK_TAKEN_OVER_CODE,
  type AgentCall,
} from "@purple/core/agent-link";
import { NOT_CONNECTED_MESSAGE } from "@purple/core/agent-tools";
import type { JsonValue } from "@purple/core/json";

export { NOT_CONNECTED_MESSAGE };

interface BrowserLinkOptions {
  /** 0 asks the OS for a free port; read the actual one from the result. */
  port: number;
  log?: (line: string) => void;
}

export interface BrowserLink {
  readonly port: number;
  connected(): boolean;
  call(call: AgentCall, timeoutMs: number): Promise<JsonValue>;
  close(): Promise<void>;
}

interface PendingCall {
  resolve(value: JsonValue): void;
  reject(reason: Error): void;
  timer: NodeJS.Timeout;
}

export async function createBrowserLink(
  options: BrowserLinkOptions,
): Promise<BrowserLink> {
  const log = options.log ?? (() => {});
  const pending = new Map<string, PendingCall>();
  let tab: WebSocket | null = null;

  const dropPending = (reason: string) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  };

  const server = new WebSocketServer({ host: "127.0.0.1", port: options.port });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  server.on("connection", (socket) => {
    if (tab) {
      tab.close(LINK_TAKEN_OVER_CODE, "Another Purple tab connected.");
      dropPending("The Purple tab was replaced by a new connection.");
    }
    tab = socket;
    let greeted = false;
    log("Purple tab connected.");

    socket.on("message", (data) => {
      const text = data.toString();
      if (!greeted) {
        const hello = decodeAgentHello(text);
        if (!hello || hello.protocol !== AGENT_LINK_PROTOCOL) {
          socket.close(4001, "Unsupported agent-link protocol.");
          return;
        }
        greeted = true;
        return;
      }
      const response = decodeAgentResponse(text);
      if (!response) return;
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(new Error(response.error));
    });

    socket.on("close", () => {
      if (tab !== socket) return;
      tab = null;
      log("Purple tab disconnected.");
      dropPending("The Purple tab disconnected before answering.");
    });

    socket.on("error", () => socket.close());
  });

  // SAFETY: bound to a numeric port on an IP host and already listening, so
  // address() returns an AddressInfo, never a pipe name or null.
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    connected: () => tab !== null && tab.readyState === WebSocket.OPEN,

    call(call, timeoutMs) {
      return new Promise((resolve, reject) => {
        const socket = tab;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          reject(new Error(NOT_CONNECTED_MESSAGE));
          return;
        }
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              `Purple did not answer ${call.method} within ` +
                `${Math.round(timeoutMs / 1000)} seconds.`,
            ),
          );
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(encodeAgentRequest({ id, ...call }));
      });
    },

    async close() {
      dropPending("The bridge is shutting down.");
      tab?.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
