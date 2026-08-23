import { CodeBlockRenderer } from "./CodeBlockRenderer";
import type { Message } from "../../shared/types";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] px-3 py-2 rounded-lg bg-hot/12 border border-hot/15 text-ink/90">
          <p className="text-sm font-display">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] px-3 py-2 rounded-lg bg-surface-lighter/80 border border-accent/10 text-gray-300">
        <div className="text-sm leading-relaxed">
          <CodeBlockRenderer text={message.content} />
        </div>
      </div>
    </div>
  );
}
