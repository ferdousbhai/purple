// The webview-layer types shared with the hosted app live in @riff/core;
// re-exported here so desktop modules keep one import site for both.
export type {
  ChatMessage,
  EvalResult,
  PlaybackState,
  RiffBackend,
  SourceRange,
  StreamOutcome,
  TitleGenerationResult,
  TransitionSuggestion,
  TransitionSuggestionsResult,
} from "@riff/core/types";
export { MAX_CONTEXT_MESSAGES } from "@riff/core/types";

import type { ChatMessage } from "@riff/core/types";

/** A chat turn as the desktop transcript renders it. */
export interface Message extends ChatMessage {
  id: string;
}

export type ApiKeySource = "app" | "env" | "missing";

export interface ApiKeyStatus {
  hasKey: boolean;
  source: ApiKeySource;
}

/** A desktop media-control request (MPRIS on Linux) forwarded by the shell. */
export type MediaControlAction = "play" | "pause" | "play-pause" | "stop";

/** Best-effort colors read from the Omarchy system theme, if one is active. */
export interface SystemTheme {
  background: string | null;
  foreground: string | null;
  accent: string | null;
  mode: "light" | "dark";
}

export type SavePatternResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string };

/** A pattern plus the prompt that produced it, when known. */
export interface PatternContext {
  code: string;
  sourcePrompt?: string;
}
