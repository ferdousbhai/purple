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
