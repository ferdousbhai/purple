import { useState, useCallback, useRef, useEffect } from "react";
import { extractPattern } from "../../shared/pattern-extractor";
import { electroview, setStreamHandler } from "../rpc";
import type { Message } from "../../shared/types";

interface StreamSession {
  assistantId: string;
  baseMessages: Message[];
  resolve?: () => void;
  text: string;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const busyRef = useRef(false);
  const idCounter = useRef(0);
  const streamRef = useRef<StreamSession | null>(null);

  function nextId(): string {
    return String(++idCounter.current);
  }

  useEffect(() => {
    setStreamHandler({
      onDelta: (delta) => {
        const stream = streamRef.current;
        if (!stream) return;

        stream.text += delta;
        setStreamingText(stream.text);
        setMessages([
          ...stream.baseMessages,
          {
            id: stream.assistantId,
            role: "assistant",
            content: stream.text,
          },
        ]);
      },
      onDone: () => streamRef.current?.resolve?.(),
      onError: (error) => {
        const stream = streamRef.current;
        if (!stream) return;

        stream.text = `Error: ${error}`;
        stream.resolve?.();
      },
    });

    return () => setStreamHandler({});
  }, []);

  const abortStream = useCallback(() => {
    electroview.rpc!.request.abortStream({});
    streamRef.current?.resolve?.();
  }, []);

  const sendMessage = useCallback(
    async (text: string): Promise<string | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;

      const userMsg: Message = { id: nextId(), role: "user", content: text };
      const updated = [...messagesRef.current, userMsg];
      messagesRef.current = updated;
      setMessages([...updated]);
      setIsStreaming(true);
      setStreamingText("");
      streamRef.current = {
        assistantId: nextId(),
        baseMessages: updated,
        text: "",
      };

      await new Promise<void>((resolve) => {
        if (streamRef.current) streamRef.current.resolve = resolve;
        electroview
          .rpc!.request.startStream({ messages: updated })
          .catch((err: unknown) => {
            const stream = streamRef.current;
            if (!stream) return;

            stream.text = `Error: ${err instanceof Error ? err.message : String(err)}`;
            stream.resolve?.();
          });
      });

      const stream = streamRef.current;
      const fullText = stream?.text ?? "";
      const pattern = extractPattern(fullText);
      const assistantMsg: Message = {
        id: stream?.assistantId ?? nextId(),
        role: "assistant",
        content: fullText,
        pattern: pattern || undefined,
      };
      const final = [...updated, assistantMsg];
      messagesRef.current = final;
      setMessages(final);
      setStreamingText("");
      setIsStreaming(false);
      busyRef.current = false;
      streamRef.current = null;

      return pattern;
    },
    [],
  );

  return { messages, streamingText, isStreaming, sendMessage, abortStream };
}

export function buildRetryMessage(code: string, error: string): string {
  return `The pattern you generated failed to evaluate with this error:\n\`\`\`\n${error}\n\`\`\`\nOriginal code:\n\`\`\`strudel\n${code}\n\`\`\`\nPlease fix the code. Remember: no variable declarations, no .play(), just a single Strudel expression.`;
}
