/**
 * The evaluation-repair loop used by the browser studio: when a model-generated
 * pattern fails to evaluate, the error goes back to Gemini and each fix
 * replays, up to MAX_RETRIES fixes. The caller supplies the playback attempt,
 * the model round-trip, and the staleness guards.
 */

import { buildRetryMessage } from "./prompts";
import {
  buildValidationRetryMessage,
  type ValidationProblem,
} from "./validation";
import type { EvalResult } from "./types";

export const MAX_RETRIES = 10;

export interface RepairDeps {
  /** Run the play/transition operation with the given code. */
  attempt: (code: string) => Promise<EvalResult>;
  /** True when the code is the model-generated pattern. Hand-edited code is
   * never repaired: silently rewriting a user's edit would be surprising, so
   * its evaluation error surfaces in the UI instead. */
  isGeneratedPattern: (code: string) => boolean;
  /** Send the repair prompt to the model; resolves with the fixed pattern, or
   * null when the request failed or produced no pattern. */
  requestFix: (message: string) => Promise<string | null>;
  /** Land a fixed pattern in the editor before it replays. */
  applyFix: (code: string) => void;
  /** True when a newer prompt replaced the pattern while the fix streamed. */
  isStale: () => boolean;
  /** True when the user stopped playback while the fix streamed. */
  isStopped: () => boolean;
  /** Repair budget for this attempt. Generation-time validation and play-time
   * repair share MAX_RETRIES per pattern, so a caller that already spent
   * fixes on validation passes the remainder. Defaults to MAX_RETRIES. */
  maxRetries?: number;
}

export interface RepairOutcome {
  result: EvalResult;
  code: string;
}

/**
 * Evaluate `code`; when a generated pattern fails to evaluate, hand the error
 * back to Gemini as a hidden chat message and replay each fix, up to
 * MAX_RETRIES fixes. The caller invokes this from the user's PLAY/XFADE
 * gesture, so the audio context is already unlocked when a fix replays.
 */
export async function attemptWithRepair(
  code: string,
  deps: RepairDeps,
): Promise<RepairOutcome> {
  let currentCode = code;
  let result = await deps.attempt(currentCode);
  if (!deps.isGeneratedPattern(code)) return { result, code: currentCode };

  let retriesLeft = deps.maxRetries ?? MAX_RETRIES;
  while (!result.ok && result.kind === "evaluation" && retriesLeft > 0) {
    retriesLeft--;
    const fixed = await deps.requestFix(
      buildRetryMessage(currentCode, result.error),
    );
    if (!fixed || deps.isStale()) break;
    deps.applyFix(fixed);
    currentCode = fixed;
    // Keep the fix in the editor, but never restart audio the user stopped.
    if (deps.isStopped()) break;
    result = await deps.attempt(currentCode);
  }
  return { result, code: currentCode };
}

export interface ValidationRepairDeps {
  /** Audit the code against the live engine. Resolves with the problems found
   * (empty = plays correctly), or null when the engine is not initialized
   * yet - validation is then skipped and play-time repair remains the net. */
  validate: (code: string) => Promise<ValidationProblem[] | null>;
  /** Send the repair prompt to the model; resolves with the fixed pattern, or
   * null when the request failed or produced no pattern. */
  requestFix: (message: string) => Promise<string | null>;
  /** Land a fixed pattern in the editor. */
  applyFix: (code: string) => void;
  /** True when a newer prompt replaced the pattern while the fix streamed. */
  isStale: () => boolean;
  maxRetries?: number;
}

export interface ValidationOutcome {
  code: string;
  /** Problems still present when the loop ended (empty on success or skip). */
  problems: ValidationProblem[];
  /** Fixes spent, so play-time repair can be handed the remaining budget. */
  retriesUsed: number;
}

/**
 * Validate a freshly generated pattern and repair it before the user plays
 * it: audit against the live engine (evaluation, empty pattern, sound names
 * that would play silence), hand any problems back to Gemini as a hidden
 * message, and re-audit each fix, up to `maxRetries` fixes. Runs right after
 * generation, so most failures are fixed while the user is still reading.
 */
export async function repairUntilValid(
  code: string,
  deps: ValidationRepairDeps,
): Promise<ValidationOutcome> {
  let currentCode = code;
  let retriesUsed = 0;
  let problems = (await deps.validate(currentCode)) ?? [];
  const maxRetries = deps.maxRetries ?? MAX_RETRIES;

  while (problems.length > 0 && retriesUsed < maxRetries) {
    if (deps.isStale()) break;
    retriesUsed++;
    const fixed = await deps.requestFix(
      buildValidationRetryMessage(currentCode, problems),
    );
    if (!fixed || deps.isStale()) break;
    deps.applyFix(fixed);
    currentCode = fixed;
    problems = (await deps.validate(currentCode)) ?? [];
  }

  return { code: currentCode, problems, retriesUsed };
}
