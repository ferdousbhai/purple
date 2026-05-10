import { useState, useCallback, useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { EditorPanel } from "./components/EditorPanel";
import { ChatPanel } from "./components/ChatPanel";
import { useChat, buildRetryMessage } from "./hooks/useChat";
import { usePlayback } from "./hooks/usePlayback";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { electroview } from "./rpc";
import type { ApiKeyStatus, PlaybackState } from "../shared/types";

const MAX_RETRIES = 2;
const EQ_BAR_DELAYS = [0, 0.15, 0.3, 0.1, 0.25];

const STATUS_LED_CLASSES = {
  active: "bg-neon-lime animate-glow-pulse shadow-[0_0_6px_#39ff1480]",
  busy: "bg-neon-amber animate-glow-pulse shadow-[0_0_6px_#ffb80080]",
  idle: "bg-white/20",
};

type StatusLedState = keyof typeof STATUS_LED_CLASSES;

export function App() {
  const [code, setCode] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({
    hasKey: false,
    source: "missing",
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    messages,
    streamingText,
    isStreaming,
    sendMessage,
    abortStream,
    clearChat,
  } =
    useChat();
  const {
    isReady,
    playbackState,
    error,
    activeCode,
    activeRanges,
    initAudio,
    play,
    stop,
  } =
    usePlayback();

  useKeyboardShortcuts({
    onStop: stop,
    onAbort: abortStream,
    isStreaming,
  });

  useEffect(() => {
    electroview
      .rpc!.request.getApiKeyStatus({})
      .then(setApiKeyStatus)
      .catch(() => {});
  }, []);

  const handleSaveApiKey = useCallback(async (apiKey: string) => {
    const status = await electroview.rpc!.request.saveApiKey({ apiKey });
    setApiKeyStatus(status);
  }, []);

  const handleClearApiKey = useCallback(async () => {
    const status = await electroview.rpc!.request.clearApiKey({});
    setApiKeyStatus(status);
  }, []);

  const handlePrompt = useCallback(
    async (text: string) => {
      const pattern = await sendMessage(text);
      if (!pattern) return;

      setCode(pattern);
      if (!isReady) await initAudio();
      const result = await play(pattern);
      if (result.ok || !result.error) return;

      // Auto-retry: if evaluation fails, ask Claude to fix (up to MAX_RETRIES)
      let lastError = result.error;
      let lastCode = pattern;

      for (let i = 0; i < MAX_RETRIES; i++) {
        const fixedPattern = await sendMessage(
          buildRetryMessage(lastCode, lastError),
        );
        if (!fixedPattern) break;

        setCode(fixedPattern);
        const retryResult = await play(fixedPattern);
        if (retryResult.ok) break;

        lastError = retryResult.error ?? "Unknown error";
        lastCode = fixedPattern;
      }
    },
    [isReady, initAudio, sendMessage, play],
  );

  const handleSendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const latestApiKeyStatus = await electroview.rpc!.request.getApiKeyStatus({});
      setApiKeyStatus(latestApiKeyStatus);
      if (!latestApiKeyStatus.hasKey) {
        setIsSettingsOpen(true);
        return false;
      }

      // Kick off audio init from user gesture (click/Enter) synchronously,
      // then don't block chat on it completing
      initAudio().catch(() => {});

      void handlePrompt(text);
      return true;
    },
    [handlePrompt, initAudio],
  );

  const handlePlay = useCallback(
    async (editorCode: string) => {
      if (!isReady) await initAudio();
      return play(editorCode);
    },
    [isReady, initAudio, play],
  );

  const status = getStatusLedState(playbackState, isStreaming);

  return (
    <div className="h-screen bg-surface text-white relative noise grid-bg overflow-hidden">
      <div className="h-9 flex items-center px-4 border-b border-neon-cyan/10 bg-surface/80 backdrop-blur-sm relative z-10">
        <div className="flex items-center gap-2">
          <span className="text-neon-cyan glow-cyan font-display font-bold text-sm tracking-wider">
            RIFF
          </span>
          <span className="text-[10px] font-mono text-neon-cyan/40 tracking-widest uppercase">
            synth console
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            title="API key settings"
            aria-label="API key settings"
            className="h-6 px-2 rounded border border-white/10 bg-surface-lighter/35
              text-[10px] font-mono tracking-widest text-white/45 transition-all
              hover:border-neon-cyan/45 hover:bg-neon-cyan/10 hover:text-neon-cyan
              focus:outline-none focus:border-neon-cyan/60 focus:text-neon-cyan"
          >
            KEY
          </button>
          {playbackState === "playing" && <EqBars />}
          <StatusLed state={status} />
        </div>
      </div>

      <Group orientation="horizontal" className="h-[calc(100%-2.25rem)]">
        <Panel defaultSize="55%" minSize="30%">
          <EditorPanel
            code={code}
            onCodeChange={setCode}
            playbackState={playbackState}
            error={error}
            activeRanges={code === activeCode ? activeRanges : []}
            onPlay={handlePlay}
            onStop={stop}
          />
        </Panel>

        <Separator className="w-[3px] bg-neon-cyan/10 hover:bg-neon-cyan/60 transition-all cursor-col-resize relative" />

        <Panel defaultSize="45%" minSize="25%">
          <ChatPanel
            messages={messages}
            streamingText={streamingText}
            isStreaming={isStreaming}
            onSendMessage={handleSendMessage}
            onClearChat={clearChat}
          />
        </Panel>
      </Group>

      {isSettingsOpen && (
        <ApiKeyDialog
          status={apiKeyStatus}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveApiKey}
          onClear={handleClearApiKey}
        />
      )}
    </div>
  );
}

function getStatusLedState(
  playbackState: PlaybackState,
  isStreaming: boolean,
): StatusLedState {
  if (playbackState === "playing") return "active";
  if (isStreaming) return "busy";
  return "idle";
}

function EqBars() {
  return (
    <div className="flex items-end gap-[2px] h-3.5">
      {EQ_BAR_DELAYS.map((delay, i) => (
        <div
          key={i}
          className="w-[3px] bg-neon-lime rounded-full animate-bar-bounce origin-bottom"
          style={{
            animationDelay: `${delay}s`,
            height: "100%",
          }}
        />
      ))}
    </div>
  );
}

function StatusLed({ state }: { state: StatusLedState }) {
  return (
    <div
      className={`w-2 h-2 rounded-full ${STATUS_LED_CLASSES[state]} transition-colors`}
    />
  );
}

interface ApiKeyDialogProps {
  status: ApiKeyStatus;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<void>;
  onClear: () => Promise<void>;
}

function ApiKeyDialog({
  status,
  onClose,
  onSave,
  onClear,
}: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const sourceText =
    status.source === "app"
      ? "Using app key"
      : "No key set";

  async function handleSubmit(): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError("Enter an Anthropic API key.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSave(trimmed);
      setApiKey("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save API key.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear API key.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-title"
        className="w-[min(92vw,440px)] rounded-lg border border-neon-cyan/25
          bg-surface-light shadow-[0_0_30px_#00fff51f]"
      >
        <div className="flex items-center border-b border-neon-cyan/10 px-4 py-3">
          <div>
            <h2
              id="api-key-title"
              className="font-display text-sm font-semibold text-white/85"
            >
              Anthropic API Key
            </h2>
            <p className="mt-0.5 text-[10px] font-mono uppercase tracking-widest text-neon-cyan/55">
              {sourceText}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="ml-auto grid size-7 place-items-center rounded border border-white/10
              bg-surface-lighter/30 text-white/45 transition-all
              hover:border-neon-magenta/45 hover:text-neon-magenta
              focus:outline-none focus:border-neon-magenta/60"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 p-4">
          <input
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setError("");
            }}
            type="password"
            autoComplete="off"
            placeholder="sk-ant-..."
            className="w-full rounded-lg border border-white/10 bg-surface/80 px-3 py-2
              font-mono text-sm text-white/90 placeholder-white/20 transition-all
              focus:border-neon-cyan/45 focus:outline-none focus:shadow-[0_0_10px_#00fff520]"
          />

          {error && (
            <p className="text-xs font-mono text-neon-magenta/85">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSaving}
              className="rounded-lg border border-neon-cyan/35 bg-neon-cyan/15 px-3 py-2
                text-xs font-mono font-medium tracking-wider text-neon-cyan transition-all
                hover:border-neon-cyan/60 hover:bg-neon-cyan/25
                disabled:cursor-not-allowed disabled:opacity-35"
            >
              SAVE
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={isSaving || status.source !== "app"}
              className="rounded-lg border border-white/10 bg-surface-lighter/35 px-3 py-2
                text-xs font-mono font-medium tracking-wider text-white/45 transition-all
                hover:border-neon-magenta/45 hover:text-neon-magenta
                disabled:cursor-not-allowed disabled:opacity-30"
            >
              CLEAR APP KEY
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
