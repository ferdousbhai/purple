/**
 * The evaluation-repair loop shared by the desktop webview and the web app:
 * when a model-generated pattern fails to evaluate, the error goes back to
 * Gemini and each fix replays, up to MAX_RETRIES fixes. The caller supplies
 * the playback attempt, the model round-trip, and the staleness guards.
 */

import { buildRetryMessage } from "./prompts";
import type { EvalResult } from "./types";

export const MAX_RETRIES = 2;

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

  let retriesLeft = MAX_RETRIES;
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
