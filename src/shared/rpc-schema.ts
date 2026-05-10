import type { RPCSchema } from "electrobun/bun";
import type { ApiKeyStatus, Message } from "./types";

export type RiffRPC = {
  bun: RPCSchema<{
    requests: {
      startStream: {
        params: { messages: Message[] };
        response: { ok: boolean };
      };
      abortStream: {
        params: Record<string, never>;
        response: { ok: boolean };
      };
      getApiKeyStatus: {
        params: Record<string, never>;
        response: ApiKeyStatus;
      };
      saveApiKey: {
        params: { apiKey: string };
        response: ApiKeyStatus;
      };
      clearApiKey: {
        params: Record<string, never>;
        response: ApiKeyStatus;
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      streamDelta: { delta: string };
      streamDone: Record<string, never>;
      streamError: { error: string };
    };
  }>;
};
