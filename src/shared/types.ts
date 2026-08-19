export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// An odd limit preserves user/model pairs when the newest turn is a user message.
export const MAX_CONTEXT_MESSAGES = 13;

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

export type ApiKeySource = "app" | "env" | "missing";

export interface ApiKeyStatus {
  hasKey: boolean;
  source: ApiKeySource;
}

export type TitleGenerationResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

export interface TransitionSuggestion {
  label: string;
  prompt: string;
}

export type TransitionSuggestionsResult =
  | { ok: true; suggestions: TransitionSuggestion[] }
  | { ok: false; error: string };

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
