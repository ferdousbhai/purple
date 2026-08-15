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
} from "../prompt-presets";
import type { Message } from "../../shared/types";

interface ChatPanelProps {
  messages: Message[];
  streamingText: string;
  error: string | null;
  isStreaming: boolean;
  isInputDisabled: boolean;
  onSendMessage: (text: string) => boolean;
  onClearChat: () => void;
}
export function ChatPanel({
  messages,
  streamingText,
  error,
  isStreaming,
  isInputDisabled,
  onSendMessage,
  onClearChat,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
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
    onSendMessage(text);
  }

  function handleSubmit(): void {
    const text = inputValue.trim();
    if (!text || isInputDisabled) return;

    const didSend = onSendMessage(text);
    if (didSend) setInputValue("");
  }

  function handleSelectPreset(preset: PromptPreset): void {
    submitPrompt(preset.prompt);
  }

  function handleSelectModifier(mod: PromptModifier): void {
    submitPrompt(mod.prompt);
  }

  function handleSurpriseMe(): void {
    submitPrompt(generateRandomPrompt());
  }

  function handleClear(): void {
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
  const canClear =
    messages.length > 0 || Boolean(streamingText) || Boolean(inputValue.trim());

  return (
    <div className="flex flex-col h-full bg-surface/80">
      <div className="px-4 py-2 border-b border-neon-cyan/10 bg-surface/60">
        <div className="flex items-center gap-2">
          <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-neon-cyan/60" />
          <span className="text-[11px] font-mono font-medium text-neon-cyan/70 tracking-widest uppercase">
            Chat
          </span>
          <button
            type="button"
            onClick={handleClear}
            disabled={!canClear}
            title="Start over"
            aria-label="Clear chat and start over"
            className="ml-auto grid size-7 place-items-center rounded border border-white/10
              bg-surface-lighter/30 text-base leading-none text-white/35 transition-all
              hover:border-neon-magenta/45 hover:bg-neon-magenta/10 hover:text-neon-magenta
              hover:shadow-[0_0_12px_#ff2d9525]
              focus:outline-none focus:border-neon-magenta/60 focus:text-neon-magenta
              focus:shadow-[0_0_12px_#ff2d9530]
              disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:border-white/10
              disabled:hover:bg-surface-lighter/30 disabled:hover:text-white/35
              disabled:hover:shadow-none"
          >
            <span aria-hidden="true">↺</span>
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
              <div className="inline-flex items-center justify-center size-10 rounded-full bg-neon-cyan/10 border border-neon-cyan/25 text-xl mb-1 shadow-[0_0_15px_#00fff520]">
                🎹
              </div>
              <h2 className="text-sm font-display font-medium text-white/90">
                What do you want to create?
              </h2>
              <p className="text-[11px] font-mono text-white/40">
                pick a starter vibe or roll the dice
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto w-full px-1">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  disabled={isInputDisabled}
                  className="group relative flex flex-col items-start p-2.5 rounded-lg border border-white/8
                    bg-surface-lighter/40 hover:bg-surface-lighter/80 hover:border-neon-cyan/40
                    text-left transition-all hover:shadow-[0_0_14px_#00fff515]
                    focus:outline-none focus:border-neon-cyan/50 disabled:opacity-40"
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <span aria-hidden="true" className="text-sm">{preset.emoji}</span>
                    <span className="text-xs font-display font-semibold text-white/80 group-hover:text-neon-cyan transition-colors">
                      {preset.title}
                    </span>
                    <span className="ml-auto text-[9px] font-mono text-white/30 group-hover:text-neon-cyan/60">
                      {preset.genre}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-white/40 line-clamp-2 leading-relaxed">
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
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-neon-cyan/30
                  bg-neon-cyan/10 hover:bg-neon-cyan/20 text-neon-cyan text-xs font-mono
                  transition-all hover:shadow-[0_0_15px_#00fff525] hover:border-neon-cyan/60
                  focus:outline-none disabled:opacity-40"
              >
                <span aria-hidden="true">🎲</span>
                <span>Surprise Me with a Random Recipe</span>
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && (
          <div role="status" className="flex justify-start mb-3">
            <div className="max-w-[85%] px-3 py-2 rounded-lg bg-surface-lighter/80 border border-neon-cyan/10 text-gray-200">
              <StreamingText text={streamingText} />
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-3 rounded-lg border border-neon-magenta/20 bg-neon-magenta/10 px-3 py-2 text-xs font-mono text-neon-magenta">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Modifier chips for continuous music evolution */}
      {!isEmpty && (
        <div className="px-3 py-1.5 border-t border-neon-cyan/10 bg-surface-light/40 overflow-x-auto flex items-center gap-1.5 scrollbar-thin">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neon-cyan/50 whitespace-nowrap mr-1">
            Transform:
          </span>
          {PROMPT_MODIFIERS.map((mod) => (
            <button
              key={mod.id}
              type="button"
              onClick={() => handleSelectModifier(mod)}
              disabled={isInputDisabled}
              title={mod.prompt}
              className="px-2.5 py-0.5 rounded-full text-[10px] font-mono whitespace-nowrap
                border border-white/10 bg-surface-lighter/40 text-white/70
                hover:border-neon-cyan/40 hover:bg-neon-cyan/10 hover:text-neon-cyan
                transition-all focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {mod.label}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-neon-magenta/10 p-3 bg-surface/60">
        <div className="flex gap-2">
          <textarea
            aria-label="Describe the music to generate"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "generating..."
                : isInputDisabled
                  ? "starting audio..."
                  : "describe your sound..."
            }
            disabled={isInputDisabled}
            rows={1}
            className="flex-1 bg-surface-lighter/60 border border-white/8 rounded-lg px-3 py-2
              text-sm font-mono text-white/90 placeholder-white/20 resize-none
              focus:outline-none focus:border-neon-cyan/40 focus:shadow-[0_0_8px_#00fff520]
              disabled:opacity-40 transition-all"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isInputDisabled || !inputValue.trim()}
            className="px-4 py-2 bg-neon-cyan/15 hover:bg-neon-cyan/25 text-neon-cyan
              border border-neon-cyan/30 hover:border-neon-cyan/60
              rounded-lg text-xs font-mono font-medium tracking-wider transition-all
              hover:shadow-[0_0_12px_#00fff530]
              disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            SEND
          </button>
        </div>
        <div className="mt-1.5 flex gap-3 text-[9px] font-mono text-white/15 tracking-wider">
          <span>⏎ send</span>
          <span>⇧⏎ newline</span>
          <span>esc cancel</span>
          <span>ctrl+. stop</span>
        </div>
      </div>
    </div>
  );
}
