import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  decodeAgentRequest,
  encodeAgentHello,
  encodeAgentResponse,
} from "@purple/core/agent-link";
import {
  createBrowserLink,
  NOT_CONNECTED_MESSAGE,
  type BrowserLink,
} from "./browser-link.ts";

let link: BrowserLink | null = null;
let tab: WebSocket | null = null;

afterEach(async () => {
  tab?.terminate();
  tab = null;
  await link?.close();
  link = null;
});

async function openLink(): Promise<BrowserLink> {
  link = await createBrowserLink({ port: 0 });
  return link;
}

async function connectTab(port: number): Promise<WebSocket> {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const candidate = new WebSocket(`ws://127.0.0.1:${port}`);
    candidate.once("open", () => resolve(candidate));
    candidate.once("error", reject);
  });
  socket.send(encodeAgentHello());
  tab = socket;
  return socket;
}

function answerRequests(socket: WebSocket, answer: (method: string) => string | null): void {
  socket.on("message", (data) => {
    const request = decodeAgentRequest(data.toString());
    if (!request) return;
    const error = answer(request.method);
    socket.send(
      error === null
        ? encodeAgentResponse({
            id: request.id,
            ok: true,
            result: { method: request.method },
          })
        : encodeAgentResponse({ id: request.id, ok: false, error }),
    );
  });
}

describe("createBrowserLink", () => {
  it("rejects calls while no tab is connected", async () => {
    const bridge = await openLink();
    await expect(bridge.call({ method: "play" }, 1_000)).rejects.toThrow(
      NOT_CONNECTED_MESSAGE,
    );
  });

  it("forwards calls to the tab and resolves with its result", async () => {
    const bridge = await openLink();
    const socket = await connectTab(bridge.port);
    answerRequests(socket, () => null);
    await expect.poll(() => bridge.connected()).toBe(true);

    await expect(bridge.call({ method: "get_session" }, 1_000)).resolves.toEqual(
      { method: "get_session" },
    );
  });

  it("relays a studio failure as a rejection", async () => {
    const bridge = await openLink();
    const socket = await connectTab(bridge.port);
    answerRequests(socket, () => "Audio output is blocked.");
    await expect.poll(() => bridge.connected()).toBe(true);

    await expect(bridge.call({ method: "play" }, 1_000)).rejects.toThrow(
      "Audio output is blocked.",
    );
  });

  it("times out a call the tab never answers", async () => {
    const bridge = await openLink();
    await connectTab(bridge.port);
    await expect.poll(() => bridge.connected()).toBe(true);

    await expect(bridge.call({ method: "stop" }, 50)).rejects.toThrow(
      "did not answer stop",
    );
  });

  it("fails pending calls when the tab disconnects", async () => {
    const bridge = await openLink();
    const socket = await connectTab(bridge.port);
    await expect.poll(() => bridge.connected()).toBe(true);

    const pending = bridge.call({ method: "get_session" }, 5_000);
    socket.terminate();
    await expect(pending).rejects.toThrow("disconnected before answering");
  });
});
