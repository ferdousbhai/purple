export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  pattern?: string; // extracted Strudel code, if any
}

export type PlaybackState = "stopped" | "playing" | "loading" | "error";

export type SourceRange = readonly [from: number, to: number];

export interface EvalResult {
  ok: boolean;
  error?: string;
}

export type ApiKeySource = "app" | "missing";

export interface ApiKeyStatus {
  hasKey: boolean;
  source: ApiKeySource;
}
