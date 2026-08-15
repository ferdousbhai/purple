export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// An odd limit preserves user/model pairs when the newest turn is a user message.
export const MAX_CONTEXT_MESSAGES = 13;

export type PlaybackState = "stopped" | "playing" | "loading" | "error";

export type SourceRange = readonly [from: number, to: number];

export type EvalResult =
  | { ok: true }
  | { ok: false; kind: "audio" | "evaluation"; error: string }
  | { ok: false; kind: "cancelled" };

export type ApiKeySource = "app" | "env" | "missing";

export interface ApiKeyStatus {
  hasKey: boolean;
  source: ApiKeySource;
}
