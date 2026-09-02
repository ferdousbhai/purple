import { useCallback, useRef } from "react";
import {
  attemptWithRepair,
  MAX_RETRIES,
  repairUntilValid,
  type RepairOutcome,
  type ValidationOutcome,
} from "@purple/core/repair";
import type { EvalResult } from "@purple/core/types";
import type { ValidationProblem } from "@purple/core/validation";

export interface GeneratedPatternContext {
  adoptionId: number;
  code: string;
  repairsUsed: number;
  commitsToEditor: boolean;
}

export interface AdoptGeneratedPatternOptions {
  commit?: boolean;
}

interface ValidationRequest {
  code: string;
  context: GeneratedPatternContext | null;
  promise: Promise<GeneratedValidationOutcome>;
}

export interface GeneratedValidationOutcome extends ValidationOutcome {
  /** Identifies the exact adoption that initiated this validation. */
  adoptionId: number | null;
  validationSkipped: boolean;
}

export interface GeneratedAttemptOutcome extends RepairOutcome {
  /** Identifies the exact adoption that initiated this playback attempt. */
  adoptionId: number | null;
  stopped: boolean;
}

export interface PlayingRevisionOptions {
  getPlayingCode(): string | null;
  replace(code: string): Promise<EvalResult>;
}

export interface GeneratedPatternOptions {
  validatePattern(code: string): Promise<ValidationProblem[] | null>;
  requestFix(message: string): Promise<string | null>;
  onCodeChange(code: string): void;
  onPatternFixed?(broken: string, fixed: string): void;
  playingRevision?: PlayingRevisionOptions;
  /** Token that changes only when the user explicitly stops playback. */
  getStopToken(): number;
  /** Cancel repair work after ownership moves to a hand edit or unmount. */
  onInvalidate?(): void;
  onValidationProblems?(problems: readonly ValidationProblem[]): void;
}

/** Replace playback only when it is still running a superseded revision. */
export async function replacePlayingRevision(
  supersededCodes: readonly string[],
  revisedCode: string,
  playback: PlayingRevisionOptions,
): Promise<EvalResult | null> {
  const playingCode = playback.getPlayingCode();
  if (
    playingCode === null ||
    playingCode === revisedCode ||
    !supersededCodes.includes(playingCode)
  ) {
    return null;
  }
  return playback.replace(revisedCode);
}

/** Own the provenance and shared repair budget of the pattern most recently
 * produced by the model. Host code decides whether validation blocks playback
 * or runs in the background, and which playback operation to attempt. */
export function useGeneratedPattern(options: GeneratedPatternOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const contextRef = useRef<GeneratedPatternContext | null>(null);
  const nextAdoptionIdRef = useRef(0);
  const validationRequestRef = useRef<ValidationRequest | null>(null);

  const commitRepair = useCallback(
    (
      current: GeneratedPatternContext | null,
      originalCode: string,
      fixedCode: string,
    ): GeneratedPatternContext => {
      optionsRef.current.onPatternFixed?.(current?.code ?? originalCode, fixedCode);
      const repaired = {
        adoptionId: current?.adoptionId ?? ++nextAdoptionIdRef.current,
        code: fixedCode,
        repairsUsed: (current?.repairsUsed ?? 0) + 1,
        commitsToEditor: current?.commitsToEditor ?? true,
      };
      contextRef.current = repaired;
      if (repaired.commitsToEditor) {
        optionsRef.current.onCodeChange(fixedCode);
      }
      return repaired;
    },
    [],
  );

  const adopt = useCallback((
    code: string,
    adoptOptions: AdoptGeneratedPatternOptions = {},
  ): void => {
    const commitsToEditor = adoptOptions.commit !== false;
    contextRef.current = {
      adoptionId: ++nextAdoptionIdRef.current,
      code,
      repairsUsed: 0,
      commitsToEditor,
    };
    if (commitsToEditor) optionsRef.current.onCodeChange(code);
  }, []);

  /** Publish an off-editor candidate only if it still owns the generation. */
  const commitCurrent = useCallback((outcome: GeneratedValidationOutcome): boolean => {
    const current = contextRef.current;
    if (
      current?.adoptionId !== outcome.adoptionId ||
      current.code !== outcome.code
    ) {
      return false;
    }
    if (!current.commitsToEditor) {
      contextRef.current = { ...current, commitsToEditor: true };
      optionsRef.current.onCodeChange(outcome.code);
    }
    return true;
  }, []);

  const isValidationCurrent = useCallback(
    (outcome: GeneratedValidationOutcome): boolean => {
      const current = contextRef.current;
      return (
        current !== null &&
        current.adoptionId === outcome.adoptionId &&
        current.code === outcome.code
      );
    },
    [],
  );

  /** Stop pending model work from mutating code after a hand edit or unmount. */
  const invalidate = useCallback((): void => {
    contextRef.current = null;
    validationRequestRef.current = null;
    optionsRef.current.onInvalidate?.();
  }, []);

  const isCurrent = useCallback(
    (code: string): boolean => contextRef.current?.code === code,
    [],
  );

  const validate = useCallback(
    (code: string): Promise<GeneratedValidationOutcome> => {
      const startingContext = contextRef.current;
      const inFlight = validationRequestRef.current;
      if (
        inFlight?.code === code &&
        inFlight.context === startingContext
      ) {
        return inFlight.promise;
      }

      let request: ValidationRequest | null = null;
      const promise = (async (): Promise<GeneratedValidationOutcome> => {
        let context = startingContext;
        if (context?.code !== code) {
          return {
            adoptionId: null,
            code,
            problems: [],
            retriesUsed: 0,
            validationSkipped: true,
          };
        }

        const supersededCodes: string[] = [];
        let validationSkipped = false;
        const outcome = await repairUntilValid(code, {
          validate: async (candidate) => {
            const problems = await optionsRef.current.validatePattern(candidate);
            validationSkipped = problems === null;
            return problems;
          },
          requestFix: optionsRef.current.requestFix,
          applyFix: (fixed) => {
            const broken = context?.code ?? code;
            supersededCodes.push(broken);
            context = commitRepair(context, code, fixed);
            if (request) {
              request.code = fixed;
              request.context = context;
            }
          },
          isStale: () => contextRef.current !== context,
          maxRetries: Math.max(0, MAX_RETRIES - (context?.repairsUsed ?? 0)),
        });

        if (contextRef.current === context) {
          if (outcome.problems.length > 0) {
            optionsRef.current.onValidationProblems?.(outcome.problems);
          } else if (
            supersededCodes.length > 0 &&
            optionsRef.current.playingRevision
          ) {
            await replacePlayingRevision(
              supersededCodes,
              outcome.code,
              optionsRef.current.playingRevision,
            );
          }
        }
        return {
          ...outcome,
          adoptionId: context?.adoptionId ?? null,
          validationSkipped,
        };
      })();

      request = {
        code,
        context: startingContext,
        promise,
      };
      validationRequestRef.current = request;
      void promise.then(
        () => {
          if (validationRequestRef.current === request) {
            validationRequestRef.current = null;
          }
        },
        () => {
          if (validationRequestRef.current === request) {
            validationRequestRef.current = null;
          }
        },
      );
      return promise;
    },
    [commitRepair],
  );

  const attempt = useCallback(
    async (
      code: string,
      operation: (candidate: string) => Promise<EvalResult>,
    ): Promise<GeneratedAttemptOutcome> => {
      let context = contextRef.current;
      const stopToken = optionsRef.current.getStopToken();
      const outcome = await attemptWithRepair(code, {
        attempt: operation,
        isGeneratedPattern: (candidate) => context?.code === candidate,
        requestFix: optionsRef.current.requestFix,
        applyFix: (fixed) => {
          context = commitRepair(context, code, fixed);
        },
        maxRetries: Math.max(0, MAX_RETRIES - (context?.repairsUsed ?? 0)),
        isStale: () => contextRef.current !== context,
        isStopped: () => optionsRef.current.getStopToken() !== stopToken,
      });

      return {
        ...outcome,
        adoptionId: context?.adoptionId ?? null,
        stopped: optionsRef.current.getStopToken() !== stopToken,
      };
    },
    [commitRepair],
  );

  const isAttemptCurrent = useCallback(
    (outcome: GeneratedAttemptOutcome): boolean => {
      const current = contextRef.current;
      return (
        !outcome.stopped &&
        current !== null &&
        current.adoptionId === outcome.adoptionId &&
        current.code === outcome.code
      );
    },
    [],
  );

  return {
    adopt,
    commitCurrent,
    invalidate,
    isCurrent,
    isAttemptCurrent,
    isValidationCurrent,
    validate,
    attempt,
  };
}
