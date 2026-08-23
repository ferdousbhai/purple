import type { PlaybackState } from "@purple/core/types";

export type PatternMode = "play" | "stage";

/** Never let a model response replace music that was playing when it was sent. */
export function resolveGeneratedPatternMode(
  requestedMode: PatternMode,
  playbackState: PlaybackState,
): PatternMode {
  return requestedMode === "stage" || playbackState === "playing"
    ? "stage"
    : "play";
}

export function hasUnappliedEditorChanges(
  playbackState: PlaybackState,
  editorCode: string,
  activeCode: string,
): boolean {
  return playbackState === "playing" && editorCode !== activeCode;
}
