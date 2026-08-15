import type { RPCSchema } from "electrobun/bun";
import type {
  ApiKeyStatus,
  Message,
  SavePatternResult,
  TransitionSuggestion,
} from "./types";
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
      startTitleGeneration: {
        params: { requestId: string; prompt: string };
        response: { ok: boolean };
      };
      startTransitionSuggestions: {
        params: {
          requestId: string;
          code: string;
          sourcePrompt?: string;
        };
        response: { ok: boolean };
      };
      savePattern: {
        params: { title: string; code: string };
        response: SavePatternResult;
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
      titleDone: { requestId: string; title: string };
      titleError: { requestId: string; error: string };
      transitionSuggestionsDone: {
        requestId: string;
        suggestions: TransitionSuggestion[];
      };
      transitionSuggestionsError: { requestId: string; error: string };
    };
  }>;
};
