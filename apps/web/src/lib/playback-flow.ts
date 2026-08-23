import type { PlaybackState } from "@purple/core/types";
import type { GeneratedValidationOutcome } from "@purple/ui/use-generated-pattern";
import type { TransitionResult } from "@purple/ui/use-playback";

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

export function isValidatedGeneratedPattern(
  outcome: Pick<GeneratedValidationOutcome, "problems" | "validationSkipped">,
): boolean {
  return !outcome.validationSkipped && outcome.problems.length === 0;
}

export function isTransitionInfrastructureFailure(
  result: TransitionResult,
): boolean {
  return (
    !result.ok &&
    result.kind === "evaluation" &&
    result.source === "transition"
  );
}
