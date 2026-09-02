import type { GeneratedTurn } from "./turn";

export type { TransitionSuggestion } from "./pattern";

export type PlaybackState =
  | "stopped"
  | "playing"
  | "loading"
  | "transitioning"
  | "error";

export type SourceRange = readonly [from: number, to: number];

export type EvalResult =
  | { ok: true }
  | { ok: false; kind: "audio" | "evaluation"; error: string }
  | { ok: false; kind: "cancelled" };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GeneratedTurnStreamOutcome {
  /** Gemini's reported prompt token count for this request, or null when the
   * transport did not report one. Feeds the compaction trigger. */
  promptTokens: number | null;
  turn: GeneratedTurn;
}

export interface PatternStreamCallbacks {
  onPatternDelta(delta: string): void;
  onPatternComplete(pattern: string): void;
}

export interface PatternStreamer {
  stream(
    messages: readonly ChatMessage[],
    callbacks: PatternStreamCallbacks,
  ): Promise<GeneratedTurnStreamOutcome>;
  abortStream(): Promise<void>;
}
