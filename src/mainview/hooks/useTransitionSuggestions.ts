import { useCallback, useRef, useState } from "react";
import type { TransitionSuggestion } from "../../shared/types";
import { suggestTransitions } from "../backend";

type SuggestionsStatus = "idle" | "loading" | "ready" | "error";

interface MusicContext {
  code: string;
  sourcePrompt?: string;
}

export function useTransitionSuggestions() {
  const [suggestions, setSuggestions] = useState<TransitionSuggestion[]>([]);
  const [status, setStatus] = useState<SuggestionsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may write state; older ones resolve into the void.
  const requestRef = useRef(0);

  const clear = useCallback(() => {
    requestRef.current++;
    setSuggestions([]);
    setStatus("idle");
    setError(null);
  }, []);

  const generate = useCallback(({ code, sourcePrompt }: MusicContext) => {
    const request = ++requestRef.current;
    setSuggestions([]);
    setStatus("loading");
    setError(null);

    void suggestTransitions(code, sourcePrompt).then((result) => {
      if (requestRef.current !== request) return;
      if (result.ok) {
        setSuggestions(result.suggestions);
        setStatus("ready");
        setError(null);
      } else {
        setSuggestions([]);
        setStatus("error");
        setError(result.error);
      }
    });
  }, []);

  return { suggestions, status, error, generate, clear };
}
