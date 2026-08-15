import { useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { EditorPanel } from "./components/EditorPanel";
import { ChatPanel } from "./components/ChatPanel";
import { ApiKeyDialog } from "./components/ApiKeyDialog";
import { useRiffController } from "./hooks/useRiffController";
import type { PlaybackState } from "../shared/types";

const EQ_BAR_DELAYS = [0, 0.15, 0.3, 0.1, 0.25];
const EMPTY_SOURCE_RANGES = [] as const;

const STATUS_LED_CLASSES = {
  active: "bg-neon-lime animate-glow-pulse shadow-[0_0_6px_#39ff1480]",
  busy: "bg-neon-amber animate-glow-pulse shadow-[0_0_6px_#ffb80080]",
  idle: "bg-white/20",
};

type StatusLedState = keyof typeof STATUS_LED_CLASSES;

export function App() {
  const {
    code,
    setCode,
    requiresUserActivation,
    apiKeyStatus,
    isSettingsOpen,
    setIsSettingsOpen,
    messages,
    streamingText,
    isStreaming,
    chatError,
    clearChat,
    playbackState,
    error,
    activeCode,
    activeRanges,
    stop,
    saveApiKey,
    clearApiKey,
    sendMessage,
    play,
  } = useRiffController();
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  function closeSettings(): void {
    setIsSettingsOpen(false);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }

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
            ref={settingsButtonRef}
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
            requiresUserActivation={requiresUserActivation}
            activeRanges={code === activeCode ? activeRanges : EMPTY_SOURCE_RANGES}
            onPlay={play}
            onStop={stop}
          />
        </Panel>

        <Separator className="w-[3px] bg-neon-cyan/10 hover:bg-neon-cyan/60 transition-all cursor-col-resize relative" />

        <Panel defaultSize="45%" minSize="25%">
          <ChatPanel
            messages={messages}
            streamingText={streamingText}
            isStreaming={isStreaming}
            error={chatError}
            isInputDisabled={isStreaming || playbackState === "loading"}
            onSendMessage={sendMessage}
            onClearChat={clearChat}
          />
        </Panel>
      </Group>

      {isSettingsOpen && (
        <ApiKeyDialog
          status={apiKeyStatus}
          onClose={closeSettings}
          onSave={saveApiKey}
          onClear={clearApiKey}
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
    <div aria-hidden="true" className="flex items-end gap-[2px] h-3.5">
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
      aria-label={`Status: ${state}`}
      role="status"
      className={`w-2 h-2 rounded-full ${STATUS_LED_CLASSES[state]} transition-colors`}
    />
  );
}
