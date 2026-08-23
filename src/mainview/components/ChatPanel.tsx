import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
} from "react";
import { MessageBubble } from "./MessageBubble";
import { StreamingText } from "./StreamingText";
import {
  PROMPT_PRESETS,
  PROMPT_MODIFIERS,
  generateRandomPrompt,
  type PromptPreset,
  type PromptModifier,
} from "@purple/core/recipes";
import type { Message, TransitionSuggestion } from "../../shared/types";

type TransitionSuggestionsStatus = "idle" | "loading" | "ready" | "error";

interface ChatPanelProps {
  messages: Message[];
  streamingText: string;
  error: string | null;
  isStreaming: boolean;
  isInputDisabled: boolean;
  isTransitioning: boolean;
  suggestNewSession: boolean;
  canStageNext: boolean;
  transitionSuggestions: TransitionSuggestion[];
  transitionSuggestionsStatus: TransitionSuggestionsStatus;
  transitionSuggestionsError: string | null;
  onSendMessage: (text: string, explanatoryStyle: boolean) => boolean;
  onStageNext: (text: string, explanatoryStyle: boolean) => boolean;
  onClearChat: () => void;
}
export function ChatPanel({
  messages,
  streamingText,
  error,
  isStreaming,
  isInputDisabled,
  isTransitioning,
  suggestNewSession,
  canStageNext,
  transitionSuggestions,
  transitionSuggestionsStatus,
  transitionSuggestionsError,
  onSendMessage,
  onStageNext,
  onClearChat,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const [explanatoryStyle, setExplanatoryStyle] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);

  useEffect(() => {
    if (!shouldFollowRef.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: isStreaming ? "auto" : "smooth",
    });
  }, [isStreaming, messages, streamingText]);

  function submitPrompt(text: string): void {
    if (isInputDisabled) return;
    onSendMessage(text, explanatoryStyle);
  }

  function handleSubmit(): void {
    const text = inputValue.trim();
    if (!text || isInputDisabled) return;

    const didSend = onSendMessage(text, explanatoryStyle);
    if (didSend) setInputValue("");
  }

  function handleStageNext(): void {
    const text = inputValue.trim();
    if (!text || isInputDisabled || !canStageNext) return;

    const didSend = onStageNext(text, explanatoryStyle);
    if (didSend) setInputValue("");
  }

  function handleSuggestedNext(prompt: string): void {
    if (isInputDisabled || !canStageNext) return;
    onStageNext(prompt, explanatoryStyle);
  }

  function handleSelectPreset(preset: PromptPreset): void {
    submitPrompt(preset.prompt);
  }

  function handleSelectModifier(mod: PromptModifier): void {
    if (canStageNext) {
      onStageNext(mod.prompt, explanatoryStyle);
    } else {
      submitPrompt(mod.prompt);
    }
  }

  function handleSurpriseMe(): void {
    submitPrompt(generateRandomPrompt());
  }

  function handleDelete(): void {
    if (
      !window.confirm(
        "Delete this conversation? This cannot be undone. The pattern in the editor will be kept.",
      )
    ) {
      return;
    }

    setInputValue("");
    onClearChat();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const isEmpty = messages.length === 0 && !streamingText;
  const canDelete = messages.length > 0 || Boolean(streamingText);

  return (
    <div className="flex flex-col h-full bg-surface/80">
      <div className="px-4 py-2 border-b border-accent/10 bg-surface/60">
        <div className="flex items-center gap-2">
          <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent/60" />
          <span className="text-[11px] font-mono font-medium text-accent/70 tracking-widest uppercase">
            Chat
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            title="Delete conversation"
            aria-label="Delete conversation"
            className="ml-auto h-7 rounded border border-ink/10 px-2
              bg-surface-lighter/30 text-[9px] font-mono font-medium tracking-wider text-ink/35 transition-all
              hover:border-hot/45 hover:bg-hot/10 hover:text-hot
              hover:shadow-glow-hot
              focus:outline-none focus:border-hot/60 focus:text-hot
              focus:shadow-glow-hot
              disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:border-ink/10
              disabled:hover:bg-surface-lighter/30 disabled:hover:text-ink/35
              disabled:hover:shadow-none"
          >
            DELETE
          </button>
        </div>
      </div>

      <div
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label="Chat transcript"
        onScroll={() => {
          const transcript = transcriptRef.current;
          if (!transcript) return;
          const distanceFromBottom =
            transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
          shouldFollowRef.current = distanceFromBottom <= 80;
        }}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {isEmpty && (
          <div className="flex flex-col h-full justify-between py-2 space-y-4">
            <div className="text-center space-y-1 pt-2">
              <div className="inline-flex items-center justify-center size-10 rounded-full bg-accent/10 border border-accent/25 text-xl mb-1 shadow-glow-accent">
                🎹
              </div>
              <h2 className="text-sm font-display font-medium text-ink/90">
                What do you want to create?
              </h2>
              <p className="text-[11px] font-mono text-ink/40">
                pick a pattern - try a preset or randomize
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto w-full px-1">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  disabled={isInputDisabled}
                  className="group relative flex flex-col items-start p-2.5 rounded-lg border border-ink/8
                    bg-surface-lighter/40 hover:bg-surface-lighter/80 hover:border-accent/40
                    text-left transition-all hover:shadow-glow-accent
                    focus:outline-none focus:border-accent/50 disabled:opacity-40"
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <span aria-hidden="true" className="text-sm">{preset.emoji}</span>
                    <span className="text-xs font-display font-semibold text-ink/80 group-hover:text-accent transition-colors">
                      {preset.title}
                    </span>
                    <span className="ml-auto text-[9px] font-mono text-ink/30 group-hover:text-accent/60">
                      {preset.genre}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-ink/40 line-clamp-2 leading-relaxed">
                    {preset.prompt}
                  </p>
                </button>
              ))}
            </div>

            <div className="text-center pb-2">
              <button
                type="button"
                onClick={handleSurpriseMe}
                disabled={isInputDisabled}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-accent/30
                  bg-accent/10 hover:bg-accent/20 text-accent text-xs font-mono
                  transition-all hover:shadow-glow-accent hover:border-accent/60
                  focus:outline-none disabled:opacity-40"
              >
                <span aria-hidden="true">🎲</span>
                <span>Random Pattern</span>
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && (
          <div role="status" className="flex justify-start mb-3">
            <div className="max-w-[85%] px-3 py-2 rounded-lg bg-surface-lighter/80 border border-accent/10 text-gray-200">
              <StreamingText text={streamingText} />
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-3 rounded-lg border border-hot/20 bg-hot/10 px-3 py-2 text-xs font-mono text-hot">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {suggestNewSession && !isEmpty && (
        <div
          role="status"
          className="flex items-center gap-3 border-t border-warn/15 bg-warn/5 px-3 py-2"
        >
          <span className="min-w-0 flex-1 text-[10px] font-mono leading-relaxed text-ink/50">
            This session is getting long. Start fresh for the clearest results.
          </span>
          <button
            type="button"
            onClick={handleDelete}
            className="shrink-0 rounded border border-warn/25 px-2.5 py-1 text-[10px] font-mono font-medium text-warn transition-colors hover:border-warn/50 hover:bg-warn/10 focus:outline-none focus:border-warn/60"
          >
            START OVER
          </button>
        </div>
      )}

      {/* Modifier chips for continuous music evolution */}
      {!isEmpty && (
        <div className="px-3 py-1.5 border-t border-accent/10 bg-surface-light/40 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-accent/50 whitespace-nowrap mr-1">
            Effect:
          </span>
          {PROMPT_MODIFIERS.map((mod) => (
            <button
              key={mod.id}
              type="button"
              onClick={() => handleSelectModifier(mod)}
              disabled={isInputDisabled}
              title={mod.prompt}
              className="px-2.5 py-0.5 rounded-full text-[10px] font-mono whitespace-nowrap
                border border-ink/10 bg-surface-lighter/40 text-ink/70
                hover:border-accent/40 hover:bg-accent/10 hover:text-accent
                transition-all focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {mod.label}
            </button>
          ))}
        </div>
      )}

      {canStageNext && transitionSuggestions.length > 0 && (
        <div className="px-3 py-1.5 border-t border-hot/10 bg-surface-light/40 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-hot/55 whitespace-nowrap mr-1">
            Xfade:
          </span>
          {transitionSuggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => handleSuggestedNext(suggestion.prompt)}
              disabled={isInputDisabled}
              title={suggestion.prompt}
              className="px-2.5 py-0.5 rounded-full text-[10px] font-mono
                border border-hot/15 bg-hot/5 text-ink/70
                hover:border-hot/45 hover:bg-hot/12 hover:text-hot
                transition-all focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}

      {canStageNext &&
        transitionSuggestionsStatus === "error" &&
        transitionSuggestionsError && (
          <div role="alert" className="px-3 py-1.5 border-t border-hot/10 bg-hot/5 text-[10px] font-mono text-hot/75">
            <span className="mr-2 text-hot/50">NEXT ERR</span>
            {transitionSuggestionsError}
          </div>
        )}

      <div className="border-t border-hot/10 p-3 bg-surface/60">
        <label className="mb-2 inline-flex items-center gap-2 text-[10px] font-mono text-ink/45">
          <input
            type="checkbox"
            checked={explanatoryStyle}
            disabled={isInputDisabled}
            onChange={(event) => setExplanatoryStyle(event.target.checked)}
            className="size-3.5 accent-accent"
          />
          <span className="font-medium text-ink/65">Explanatory</span>
          <span>comment every line</span>
        </label>
        <div className="flex gap-2">
          <textarea
            aria-label="Describe the music to generate"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "generating..."
                : isTransitioning
                  ? "xfading into the next pattern..."
                : isInputDisabled
                  ? "starting audio..."
                  : "describe your sound..."
            }
            disabled={isInputDisabled}
            rows={1}
            className="min-w-0 flex-1 bg-surface-lighter/60 border border-ink/8 rounded-lg px-3 py-2
              text-sm font-mono text-ink/90 placeholder-ink/20 resize-none
              focus:outline-none focus:border-accent/40 focus:shadow-glow-accent
              disabled:opacity-40 transition-all"
          />
          {canStageNext && (
            <button
              type="button"
              onClick={handleStageNext}
              disabled={isInputDisabled || !inputValue.trim()}
              title="Generate and stage the next pattern without interrupting playback"
              className="flex items-center px-2.5 py-2 bg-hot/10
                hover:bg-hot/20 text-hot border border-hot/25
                hover:border-hot/55 rounded-lg text-[10px] font-mono font-medium
                tracking-wider transition-all hover:shadow-glow-hot
                disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
            >
              XFADE NEXT
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isInputDisabled || !inputValue.trim()}
            className="px-4 py-2 bg-accent/15 hover:bg-accent/25 text-accent
              border border-accent/30 hover:border-accent/60
              rounded-lg text-xs font-mono font-medium tracking-wider transition-all
              hover:shadow-glow-accent
              disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            SEND
          </button>
        </div>
        <div className="mt-1.5 flex gap-3 text-[9px] font-mono text-ink/15 tracking-wider">
          <span>⏎ send</span>
          <span>⇧⏎ newline</span>
          <span>esc cancel</span>
          <span>ctrl+. stop</span>
        </div>
      </div>
    </div>
  );
}
