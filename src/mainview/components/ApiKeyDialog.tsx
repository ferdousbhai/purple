import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ApiKeyStatus } from "../../shared/types";

interface ApiKeyDialogProps {
  status: ApiKeyStatus;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<void>;
  onClear: () => Promise<void>;
}

export function ApiKeyDialog({
  status,
  onClose,
  onSave,
  onClear,
}: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLFormElement>(null);

  const sourceText =
    status.source === "app"
      ? "Using app key"
      : status.source === "env"
        ? "Using GEMINI_API_KEY from environment"
        : "No key set";

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError("Enter a Google Gemini API key.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSave(trimmed);
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save API key.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear(): Promise<void> {
    setIsSaving(true);
    setError("");
    try {
      await onClear();
      setApiKey("");
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : "Could not clear API key.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !isSaving) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)",
      ) ?? [],
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      <form
        ref={dialogRef}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-title"
        className="w-[min(92vw,440px)] rounded-lg border border-accent/25
          bg-surface-light shadow-glow-accent-lg"
      >
        <div className="flex items-center border-b border-accent/10 px-4 py-3">
          <div>
            <h2
              id="api-key-title"
              className="font-display text-sm font-semibold text-ink/85"
            >
              Google Gemini API Key
            </h2>
            <p className="mt-0.5 text-[10px] font-mono uppercase tracking-widest text-accent/55">
              {sourceText}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close settings"
            className="ml-auto grid size-7 place-items-center rounded border border-ink/10
              bg-surface-lighter/30 text-ink/45 transition-all
              hover:border-hot/45 hover:text-hot
              focus:outline-none focus:border-hot/60 disabled:opacity-35"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 p-4">
          <label htmlFor="gemini-api-key" className="text-xs font-mono text-ink/60">
            Gemini API key
          </label>
          <input
            id="gemini-api-key"
            autoFocus
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setError("");
            }}
            type="password"
            autoComplete="off"
            placeholder="Paste Gemini API key"
            className="w-full rounded-lg border border-ink/10 bg-surface/80 px-3 py-2
              font-mono text-sm text-ink/90 placeholder-ink/20 transition-all
              focus:border-accent/45 focus:outline-none focus:shadow-glow-accent"
          />

          <p className="text-[10px] leading-relaxed font-mono text-ink/35">
            Saved in your system keyring when available. Otherwise Purple uses an
            unencrypted fallback file in your config directory (owner-only on
            Linux).
          </p>

          {error && (
            <p role="alert" className="text-xs font-mono text-hot/85">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg border border-accent/35 bg-accent/15 px-3 py-2
                text-xs font-mono font-medium tracking-wider text-accent transition-all
                hover:border-accent/60 hover:bg-accent/25
                disabled:cursor-not-allowed disabled:opacity-35"
            >
              SAVE
            </button>
            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={isSaving || status.source !== "app"}
              className="rounded-lg border border-ink/10 bg-surface-lighter/35 px-3 py-2
                text-xs font-mono font-medium tracking-wider text-ink/45 transition-all
                hover:border-hot/45 hover:text-hot
                disabled:cursor-not-allowed disabled:opacity-30"
            >
              CLEAR APP KEY
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
