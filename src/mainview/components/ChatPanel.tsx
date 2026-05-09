import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
} from "react";
import { MessageBubble } from "./MessageBubble";
import { StreamingText } from "./StreamingText";
import type { Message } from "../../shared/types";

interface ChatPanelProps {
  messages: Message[];
  streamingText: string;
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onClearChat: () => void;
}

export function ChatPanel({
  messages,
  streamingText,
  isStreaming,
  onSendMessage,
  onClearChat,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleSubmit = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;
    setInputValue("");
    onSendMessage(text);
  }, [inputValue, isStreaming, onSendMessage]);

  const handleClear = useCallback(() => {
    setInputValue("");
    onClearChat();
  }, [onClearChat]);

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
          <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan/60" />
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

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="text-4xl">🎹</div>
            <div className="space-y-1.5">
              <p className="text-sm font-display font-medium text-white/60">
                What do you want to hear?
              </p>
              <p className="text-xs font-mono text-white/25">
                describe a vibe, genre, or feeling
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {streamingText && isStreaming && (
          <div className="flex justify-start mb-3">
            <div className="max-w-[85%] px-3 py-2 rounded-lg bg-surface-lighter/80 border border-neon-cyan/10 text-gray-200">
              <StreamingText text={streamingText} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-neon-magenta/10 p-3 bg-surface/60">
        <div className="flex gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming ? "generating..." : "describe your sound..."
            }
            disabled={isStreaming}
            rows={1}
            className="flex-1 bg-surface-lighter/60 border border-white/8 rounded-lg px-3 py-2
              text-sm font-mono text-white/90 placeholder-white/20 resize-none
              focus:outline-none focus:border-neon-cyan/40 focus:shadow-[0_0_8px_#00fff520]
              disabled:opacity-40 transition-all"
          />
          <button
            onClick={handleSubmit}
            disabled={isStreaming || !inputValue.trim()}
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
