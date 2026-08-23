import type { EvalResult, PlaybackState } from "@purple/core/types";
import type { GeneratedValidationOutcome } from "./use-generated-pattern";
import type { TransitionResult } from "./use-playback";

export type PatternMode = "play" | "stage";

export const GENERATED_PATTERN_ERROR =
  "Purple could not produce a playable pattern. Try describing the change another way.";
export const VALIDATION_UNAVAILABLE_ERROR =
  "Purple could not verify this pattern because the audio engine is unavailable. Try again.";
export const TRANSITION_ERROR =
  "The crossfade could not complete. Use PLAY to resume if playback stopped.";

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

export function validationFailureMessage(
  outcome: Pick<GeneratedValidationOutcome, "validationSkipped">,
): string {
  return outcome.validationSkipped
    ? VALIDATION_UNAVAILABLE_ERROR
    : GENERATED_PATTERN_ERROR;
}

export function generatedPlaybackFailureMessage(result: EvalResult): string | null {
  if (result.ok || result.kind === "cancelled") return null;
  return result.kind === "audio" ? result.error : GENERATED_PATTERN_ERROR;
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
