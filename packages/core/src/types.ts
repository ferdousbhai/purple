/**
 * Types shared across Purple's browser studio.
 * Type declarations plus one constant keep `@purple/core` dependency-free.
 */

import type { TransitionSuggestion } from "./pattern";

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

export interface StreamOutcome {
  /** The model stopped at its output limit rather than finishing. */
  truncated: boolean;
  /** Gemini's reported prompt token count for this request, or null when the
   * transport did not report one. Feeds the compaction trigger. */
  promptTokens: number | null;
}

export type TitleGenerationResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

export type TransitionSuggestionsResult =
  | { ok: true; suggestions: TransitionSuggestion[] }
  | { ok: false; error: string };

/**
 * Model capabilities composed by the browser studio. The interfaces remain
 * split so hooks depend only on the transport behavior they use.
 */
export interface PatternStreamer {
  /**
   * Stream a pattern response. Deltas arrive on `onDelta`; the promise settles
   * when the model finishes, and rejects with a user-facing message on failure.
   */
  stream(
    messages: readonly ChatMessage[],
    onDelta: (text: string) => void,
  ): Promise<StreamOutcome>;
  /** Cancel the in-flight stream. */
  abortStream(): Promise<void>;
}

export interface TitleGenerator {
  /** Name the pattern a prompt is about to produce. */
  generateTitle(prompt: string): Promise<TitleGenerationResult>;
}

export interface TransitionSuggester {
  /** Suggest next-move prompts for the pattern that just landed. */
  suggestTransitions(
    code: string,
    sourcePrompt?: string,
  ): Promise<TransitionSuggestionsResult>;
}
