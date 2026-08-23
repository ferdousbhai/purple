import { useCallback, useRef, useState } from "react";
import type {
  TransitionSuggester,
  TransitionSuggestion,
} from "@purple/core/types";

export interface TransitionSuggestionContext {
  code: string;
  sourcePrompt?: string;
}

export type TransitionSuggestionsStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export function useTransitionSuggestions(backend: TransitionSuggester) {
  const [suggestions, setSuggestions] = useState<TransitionSuggestion[]>([]);
  const [status, setStatus] = useState<TransitionSuggestionsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may write state; older ones resolve into the void.
  const requestRef = useRef(0);

  const clear = useCallback(() => {
    requestRef.current++;
    setSuggestions([]);
    setStatus("idle");
    setError(null);
  }, []);

  const generate = useCallback(
    ({ code, sourcePrompt }: TransitionSuggestionContext) => {
      const request = ++requestRef.current;
      setSuggestions([]);
      setStatus("loading");
      setError(null);

      void backend.suggestTransitions(code, sourcePrompt).then((result) => {
        if (requestRef.current !== request) return;
        if (result.ok) {
          setSuggestions(result.suggestions);
          setStatus("ready");
        } else {
          setStatus("error");
          setError(result.error);
        }
      });
    },
    [backend.suggestTransitions],
  );

  return { suggestions, status, error, generate, clear };
}
