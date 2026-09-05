import { useCallback, useEffect, useRef, useState } from "react";

const COPIED_FOR_MS = 2_000;

/** Copy text and show a short-lived confirmation; false when the clipboard is blocked. */
export function useClipboardCopy() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const reset = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setCopied(false);
  }, []);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      window.clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = window.setTimeout(() => setCopied(false), COPIED_FOR_MS);
      return true;
    },
    [],
  );
  return { copied, copy, reset };
}
