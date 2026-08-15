import { useCallback, useEffect, useRef, useState } from "react";
import type { TransitionSuggestion } from "../../shared/types";
import { electroview, setTransitionSuggestionsHandler } from "../rpc";

type SuggestionsStatus = "idle" | "loading" | "ready" | "error";

interface MusicContext {
  code: string;
  sourcePrompt?: string;
}

export function useTransitionSuggestions() {
  const [suggestions, setSuggestions] = useState<TransitionSuggestion[]>([]);
  const [status, setStatus] = useState<SuggestionsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const clear = useCallback(() => {
    requestIdRef.current = null;
    setSuggestions([]);
    setStatus("idle");
    setError(null);
  }, []);

  useEffect(() => {
    setTransitionSuggestionsHandler({
      onDone: (requestId, nextSuggestions) => {
        if (requestIdRef.current !== requestId) return;
        setSuggestions(nextSuggestions);
        setStatus("ready");
        setError(null);
      },
      onError: (requestId, nextError) => {
        if (requestIdRef.current !== requestId) return;
        setSuggestions([]);
        setStatus("error");
        setError(nextError);
      },
    });
    return () => setTransitionSuggestionsHandler({});
  }, []);

  const generate = useCallback(({ code, sourcePrompt }: MusicContext) => {
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    setSuggestions([]);
    setStatus("loading");
    setError(null);

    void electroview.rpc!.request
      .startTransitionSuggestions({ requestId, code, sourcePrompt })
      .catch((requestError: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setStatus("error");
        setError(
          requestError instanceof Error
            ? requestError.message
            : String(requestError),
        );
      });
  }, []);

  return { suggestions, status, error, generate, clear };
}
