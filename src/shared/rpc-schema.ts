import type { RPCSchema } from "electrobun/bun";
import type { ApiKeyStatus, Message } from "./types";
import type { StartupOptions } from "./cli";

export type RiffRPC = {
  bun: RPCSchema<{
    requests: {
      startStream: {
        params: {
          requestId: string;
          messages: Message[];
          submittedAtMs: number;
        };
        response: { ok: boolean };
      };
      abortStream: {
        params: { requestId: string };
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
      getStartupOptions: {
        params: Record<string, never>;
        response: StartupOptions;
      };
      log: {
        params: { level: string; message: string };
        response: { ok: boolean };
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      streamDelta: { requestId: string; delta: string };
      streamDone: { requestId: string };
      streamError: { requestId: string; error: string };
    };
  }>;
};
