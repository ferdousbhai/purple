import { describe, expect, it } from "vitest";
import {
  AGENT_LINK_PROTOCOL,
  decodeAgentHello,
  decodeAgentRequest,
  decodeAgentResponse,
  encodeAgentHello,
  encodeAgentRequest,
  encodeAgentResponse,
  type AgentRequest,
  type AgentResponse,
} from "./agent-link";

describe("hello frames", () => {
  it("round-trips the protocol version", () => {
    expect(decodeAgentHello(encodeAgentHello())).toEqual({
      protocol: AGENT_LINK_PROTOCOL,
    });
  });

  it("rejects other frame types and malformed text", () => {
    expect(decodeAgentHello(encodeAgentRequest({ id: "1", method: "play" }))).toBeNull();
    expect(decodeAgentHello('{"type":"hello"}')).toBeNull();
    expect(decodeAgentHello("not json")).toBeNull();
  });
});

describe("request frames", () => {
  const requests: AgentRequest[] = [
    { id: "a", method: "get_session" },
    { id: "b", method: "set_pattern", code: 's("bd*4")', title: "Four Floor" },
    { id: "c", method: "set_pattern", code: 's("hh*8")', title: null },
    { id: "d", method: "play" },
    { id: "e", method: "stop" },
  ];

  it.each(requests)("round-trips $method", (request) => {
    expect(decodeAgentRequest(encodeAgentRequest(request))).toEqual(request);
  });

  it("rejects unknown methods, missing fields, and non-request frames", () => {
    expect(
      decodeAgentRequest('{"type":"request","id":"x","method":"eval"}'),
    ).toBeNull();
    expect(
      decodeAgentRequest('{"type":"request","id":"x","method":"set_pattern"}'),
    ).toBeNull();
    expect(decodeAgentRequest('{"type":"request","method":"play"}')).toBeNull();
    expect(decodeAgentRequest(encodeAgentHello())).toBeNull();
  });

  it("treats a non-string title as absent", () => {
    expect(
      decodeAgentRequest(
        '{"type":"request","id":"x","method":"set_pattern","code":"s()","title":7}',
      ),
    ).toEqual({ id: "x", method: "set_pattern", code: "s()", title: null });
  });
});

describe("response frames", () => {
  const responses: AgentResponse[] = [
    { id: "a", ok: true, result: { code: 's("bd")', problems: [] } },
    { id: "b", ok: false, error: "Audio output is blocked." },
  ];

  it.each(responses)("round-trips ok=$ok", (response) => {
    expect(decodeAgentResponse(encodeAgentResponse(response))).toEqual(response);
  });

  it("rejects responses without a result or error to carry", () => {
    expect(decodeAgentResponse('{"type":"response","id":"x","ok":true}')).toBeNull();
    expect(decodeAgentResponse('{"type":"response","id":"x","ok":false}')).toBeNull();
    expect(decodeAgentResponse('{"type":"response","id":"x"}')).toBeNull();
  });
});
