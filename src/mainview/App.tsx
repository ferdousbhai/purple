import { useState, useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { EditorPanel } from "./components/EditorPanel";
import { ChatPanel } from "./components/ChatPanel";
import { useChat, buildRetryMessage } from "./hooks/useChat";
import { usePlayback } from "./hooks/usePlayback";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { PlaybackState } from "../shared/types";

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

  const handleSendMessage = useCallback(
    async (text: string) => {
      // Kick off audio init from user gesture (click/Enter) synchronously,
      // then don't block chat on it completing
      initAudio().catch(() => {});

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
