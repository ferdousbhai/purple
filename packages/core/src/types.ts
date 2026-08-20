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

// An odd limit preserves user/model pairs when the newest turn is a user message.
export const MAX_CONTEXT_MESSAGES = 13;

export interface StreamOutcome {
  /** The model stopped at its output limit rather than finishing. */
  truncated: boolean;
}

export type TitleGenerationResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

export type TransitionSuggestionsResult =
  | { ok: true; suggestions: TransitionSuggestion[] }
  | { ok: false; error: string };

/**
 * The generation backend a Purple UI talks to. The desktop implements it over
 * Tauri `invoke` + `Channel` (`src/mainview/backend.ts`, the only module that
 * imports `@tauri-apps/api`); the hosted app implements it over its chat agent
 * or the bring-your-own-key Gemini path.
 */
export interface PurpleBackend {
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
  /** Name the pattern a prompt is about to produce. */
  generateTitle(prompt: string): Promise<TitleGenerationResult>;
  /** Suggest next-move prompts for the pattern that just landed. */
  suggestTransitions(
    code: string,
    sourcePrompt?: string,
  ): Promise<TransitionSuggestionsResult>;
}
