/**
 * Types shared by the desktop webview and the hosted app's studio UI.
 * Type declarations plus one constant — `@purple/core` stays dependency-free
 * because the hosted build bundles it into a Cloudflare Worker.
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
 * Backend capabilities a Purple UI composes. They are split so each app
 * `satisfies` exactly what it implements — the desktop streams over Tauri
 * `invoke` + `Channel` (`src/mainview/backend.ts`), while the web streams
 * directly with the visitor's key — and the compiler catches contract drift
 * on both sides.
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

/** The full backend the desktop UI talks to. */
export interface PurpleBackend
  extends PatternStreamer,
    TitleGenerator,
    TransitionSuggester {}
