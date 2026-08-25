/**
 * Types shared across Purple's browser studio.
 * Type declarations plus one constant keep `@purple/core` dependency-free.
 */

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

/** One chat turn as the model transport sees it. */
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
  /** A decoded addition to the leading structured pattern string. */
  onPatternDelta(delta: string): void;
  /** The complete, size-checked pattern is ready for local validation. */
  onPatternComplete(pattern: string): void;
}

export interface PatternStreamer {
  /**
   * Stream a pattern response. Deltas arrive on `onDelta`; the promise settles
   * when the model finishes, and rejects with a user-facing message on failure.
   */
  stream(
    messages: readonly ChatMessage[],
    callbacks: PatternStreamCallbacks,
  ): Promise<GeneratedTurnStreamOutcome>;
  /** Cancel the in-flight stream. */
  abortStream(): Promise<void>;
}
