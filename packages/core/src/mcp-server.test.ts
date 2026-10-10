import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "./json.ts";
import {
  handleMcpMessage,
  type AgentCaller,
  type PatternPublisher,
} from "./mcp-server.ts";

const neverCalled: AgentCaller = () => {
  throw new Error("The agent caller must not run for this message.");
};

function rpc(method: string, params?: JsonValue, id: JsonValue = 1): JsonValue {
  return params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };
}

describe("handleMcpMessage", () => {
  it("negotiates a supported protocol version on initialize", async () => {
    const reply = await handleMcpMessage(
      rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {} }),
      neverCalled,
    );
    expect(reply).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "purple" },
      },
    });
  });

  it("tells the agent how a Purple set works on initialize", async () => {
    const reply = await handleMcpMessage(rpc("initialize"), neverCalled);
    // SAFETY: initialize answers with a result envelope carrying the
    // instructions string; a missing one fails the assertions below.
    const { instructions } = (reply as { result: { instructions: string } })
      .result;
    expect(instructions).toContain("get_strudel_reference");
    expect(instructions).toContain("Play a set, not a loop");
  });

  it("falls back to the latest supported version for unknown requests", async () => {
    const reply = await handleMcpMessage(
      rpc("initialize", { protocolVersion: "2099-01-01" }),
      neverCalled,
    );
    expect(reply).toMatchObject({
      result: { protocolVersion: "2025-06-18" },
    });
  });

  it("swallows notifications", async () => {
    expect(
      await handleMcpMessage(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        neverCalled,
      ),
    ).toBeNull();
  });

  it("lists the shared tool catalog", async () => {
    const reply = await handleMcpMessage(rpc("tools/list"), neverCalled);
    expect(reply).toMatchObject({
      result: {
        tools: [
          { name: "get_strudel_reference" },
          { name: "get_session" },
          { name: "set_pattern" },
          { name: "play" },
          { name: "stop" },
          { name: "share_pattern" },
        ],
      },
    });
  });

  it("serves the Strudel reference without the tab", async () => {
    const reply = await handleMcpMessage(
      rpc("tools/call", { name: "get_strudel_reference" }),
      neverCalled,
    );
    expect(reply).toMatchObject({
      result: { isError: false, content: [{ type: "text" }] },
    });
  });

  it("relays a tool call and formats the studio answer", async () => {
    const callAgent = vi.fn<AgentCaller>().mockResolvedValue({
      ok: true,
      result: { committed: true },
    });
    const reply = await handleMcpMessage(
      rpc("tools/call", {
        name: "set_pattern",
        arguments: { code: 's("bd*4")' },
      }),
      callAgent,
    );
    expect(callAgent).toHaveBeenCalledWith(
      { method: "set_pattern", code: 's("bd*4")', title: null },
      30_000,
    );
    expect(reply).toMatchObject({
      result: {
        isError: false,
        content: [{ type: "text", text: expect.stringContaining("Call play") }],
      },
    });
  });

  it("publishes the session pattern under a handle", async () => {
    const callAgent = vi.fn<AgentCaller>().mockResolvedValue({
      ok: true,
      result: { code: 's("bd*4")', title: "Night Shift", playbackState: "playing" },
    });
    const publish = vi.fn<PatternPublisher>().mockResolvedValue({
      ok: true,
      url: "https://soundspurple.com/?s=Abc_123-xYz9",
    });
    const reply = await handleMcpMessage(
      rpc("tools/call", { name: "share_pattern", arguments: { handle: "dj_anon" } }),
      callAgent,
      publish,
    );
    expect(callAgent).toHaveBeenCalledWith({ method: "get_session" }, 10_000);
    expect(publish).toHaveBeenCalledWith({
      title: "Night Shift",
      code: 's("bd*4")',
      handle: "dj_anon",
    });
    expect(reply).toMatchObject({
      result: {
        isError: false,
        content: [{ type: "text", text: expect.stringContaining("/?s=Abc_123-xYz9") }],
      },
    });
  });

  it("refuses to share where no publisher exists", async () => {
    const reply = await handleMcpMessage(
      rpc("tools/call", { name: "share_pattern" }),
      neverCalled,
    );
    expect(reply).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("hosted relay") }],
      },
    });
  });

  it("returns tab failures as tool errors", async () => {
    const reply = await handleMcpMessage(
      rpc("tools/call", { name: "play" }),
      async () => ({ ok: false, error: "No Purple tab is connected." }),
    );
    expect(reply).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("No Purple tab") }],
      },
    });
  });

  it("returns bad tool arguments as tool errors", async () => {
    const reply = await handleMcpMessage(
      rpc("tools/call", { name: "set_pattern", arguments: {} }),
      neverCalled,
    );
    expect(reply).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("code string") }],
      },
    });
  });

  it("rejects unknown tools and methods at the protocol level", async () => {
    expect(
      await handleMcpMessage(
        rpc("tools/call", { name: "make_coffee" }),
        neverCalled,
      ),
    ).toMatchObject({ error: { code: -32602 } });
    expect(await handleMcpMessage(rpc("resources/list"), neverCalled)).toMatchObject(
      { error: { code: -32601 } },
    );
    expect(await handleMcpMessage("not an object", neverCalled)).toMatchObject({
      error: { code: -32600 },
    });
  });
});
