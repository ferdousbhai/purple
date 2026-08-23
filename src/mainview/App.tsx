import { useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { EditorPanel } from "./components/EditorPanel";
import { ChatPanel } from "./components/ChatPanel";
import { ApiKeyDialog } from "./components/ApiKeyDialog";
import { PurpleMark } from "@purple/ui/purple-mark";
import { SpectrumBars } from "@purple/ui/spectrum-bars";
import { openSupportStrudel } from "./backend";
import { usePurpleController } from "./hooks/usePurpleController";
import type { PlaybackState } from "../shared/types";

const EMPTY_SOURCE_RANGES = [] as const;

const STATUS_LED_CLASSES = {
  active: "bg-active animate-glow-pulse shadow-glow-active-sm",
  busy: "bg-warn animate-glow-pulse shadow-glow-warn-sm",
  idle: "bg-ink/20",
};

type StatusLedState = keyof typeof STATUS_LED_CLASSES;

export function App() {
  const {
    code,
    setCode,
    patternTitle,
    titleStatus,
    titleError,
    updatePatternTitle,
    savePattern,
    requiresUserActivation,
    apiKeyStatus,
    isSettingsOpen,
    setIsSettingsOpen,
    messages,
    streamingText,
    isStreaming,
    chatError,
    suggestNewSession,
    clearChat,
    undoClearChat,
    playbackState,
    error,
    activeCode,
    activeRanges,
    getOutputAnalyser,
    stop,
    saveApiKey,
    clearApiKey,
    sendMessage,
    stageNext,
    transitionSuggestions,
    transitionSuggestionsStatus,
    transitionSuggestionsError,
    play,
    transition,
  } = usePurpleController();
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  function closeSettings(): void {
    setIsSettingsOpen(false);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }

  const status = getStatusLedState(playbackState, isStreaming);
  const hasPendingPattern =
    playbackState === "playing" && Boolean(code.trim()) && code !== activeCode;

  return (
    <div className="h-screen bg-surface text-ink relative noise grid-bg overflow-hidden">
      <div className="h-9 flex items-center px-4 border-b border-accent/10 bg-surface/80 backdrop-blur-sm relative z-10">
        <div className="flex items-center gap-2">
          <PurpleMark className="shrink-0" />
          <span className="text-accent glow-accent font-display font-bold text-sm tracking-wider">
            PURPLE
          </span>
          <span className="text-[10px] font-mono text-accent/40 tracking-widest uppercase">
            synth console
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => void openSupportStrudel()}
            title="Purple runs on Strudel. Support its developers on Open Collective."
            className="h-6 px-2 rounded border border-ink/10 bg-surface-lighter/35
              text-[10px] font-mono tracking-widest text-ink/45 transition-all
              hover:border-accent/45 hover:bg-accent/10 hover:text-accent
              focus:outline-none focus:border-accent/60 focus:text-accent"
          >
            ♥ STRUDEL
          </button>
          <button
            ref={settingsButtonRef}
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            title="API key settings"
            aria-label="API key settings"
            className="h-6 px-2 rounded border border-ink/10 bg-surface-lighter/35
              text-[10px] font-mono tracking-widest text-ink/45 transition-all
              hover:border-accent/45 hover:bg-accent/10 hover:text-accent
              focus:outline-none focus:border-accent/60 focus:text-accent"
          >
            KEY
          </button>
          {(playbackState === "playing" || playbackState === "transitioning") && (
            <SpectrumBars
              className="flex items-end gap-[2px] h-3.5"
              barClassName="w-[3px] h-full bg-active rounded-full origin-bottom"
              getAnalyser={getOutputAnalyser}
            />
          )}
          <StatusLed state={status} />
        </div>
      </div>

      <Group orientation="horizontal" className="h-[calc(100%-2.25rem)]">
        <Panel defaultSize="55%" minSize="30%">
          <EditorPanel
            code={code}
            onCodeChange={setCode}
            patternTitle={patternTitle}
            titleStatus={titleStatus}
            titleError={titleError}
            onTitleChange={updatePatternTitle}
            onSavePattern={savePattern}
            playbackState={playbackState}
            error={error}
            requiresUserActivation={requiresUserActivation}
            hasPendingPattern={hasPendingPattern}
            activeRanges={code === activeCode ? activeRanges : EMPTY_SOURCE_RANGES}
            onPlay={play}
            onTransition={transition}
            onStop={stop}
          />
        </Panel>

        <Separator className="w-[3px] bg-accent/10 hover:bg-accent/60 transition-all cursor-col-resize relative" />

        <Panel defaultSize="45%" minSize="25%">
          <ChatPanel
            messages={messages}
            streamingText={streamingText}
            isStreaming={isStreaming}
            error={chatError}
            isInputDisabled={
              isStreaming ||
              playbackState === "loading" ||
              playbackState === "transitioning"
            }
            isTransitioning={playbackState === "transitioning"}
            suggestNewSession={suggestNewSession}
            canStageNext={playbackState === "playing" || (transitionSuggestions.length > 0 && playbackState !== "loading" && playbackState !== "transitioning")}
            transitionSuggestions={transitionSuggestions}
            transitionSuggestionsStatus={transitionSuggestionsStatus}
            transitionSuggestionsError={transitionSuggestionsError}
            onSendMessage={sendMessage}
            onStageNext={stageNext}
            onClearChat={clearChat}
            onUndoClearChat={undoClearChat}
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
  if (playbackState === "playing" || playbackState === "transitioning") {
    return "active";
  }
  if (isStreaming) return "busy";
  return "idle";
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
