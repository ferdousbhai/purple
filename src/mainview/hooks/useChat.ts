import { useState, useCallback, useRef, useEffect } from "react";
import { extractPattern } from "@riff/core/pattern";
import { abortStream as abortBackendStream, errorMessage, streamPattern } from "../backend";
import { MAX_CONTEXT_MESSAGES, type Message } from "../../shared/types";

interface StreamSession {
  assistantId: string;
  firstDeltaSeen: boolean;
  frameId?: number;
  resolve?: () => void;
  terminalReason: "streaming" | "done" | "error" | "cancelled";
  text: string;
  truncated: boolean;
  error?: string;
  timeoutId?: ReturnType<typeof setTimeout>;
}

const STREAM_TIMEOUT_MS = 90_000;

function settleStream(
  stream: StreamSession,
  reason: Exclude<StreamSession["terminalReason"], "streaming">,
  error?: string,
): void {
  if (stream.terminalReason !== "streaming") return;
  clearTimeout(stream.timeoutId);
  if (stream.frameId !== undefined) cancelAnimationFrame(stream.frameId);
  stream.terminalReason = reason;
  stream.error = error;
  stream.resolve?.();
}

function abortBackend(context: string): void {
  void abortBackendStream().catch((error: unknown) => {
    console.error(`[Chat] Could not abort stream ${context}:`, error);
  });
}

interface ChatView {
  messages: Message[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
}

export function useChat() {
  const [view, setView] = useState<ChatView>({
    messages: [],
    streamingText: "",
    isStreaming: false,
    error: null,
  });
  const visibleMessagesRef = useRef<Message[]>([]);
  const conversationRef = useRef<Message[]>([]);
  const busyRef = useRef(false);
  const idCounter = useRef(0);
  const streamRef = useRef<StreamSession | null>(null);

  function nextId(): string {
    return String(++idCounter.current);
  }

  useEffect(() => {
    return () => {
      const stream = streamRef.current;
      if (!stream) return;

      settleStream(stream, "cancelled");
      streamRef.current = null;
      busyRef.current = false;
      abortBackend("during cleanup");
    };
  }, []);

  const abortStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    abortBackend("on request");
    settleStream(stream, "cancelled");
  }, []);

  const clearChat = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      abortBackend("while clearing the chat");
      settleStream(stream, "cancelled");
      streamRef.current = null;
    }

    visibleMessagesRef.current = [];
    conversationRef.current = [];
    setView({ messages: [], streamingText: "", isStreaming: false, error: null });
    busyRef.current = false;
  }, []);

  const sendMessage = useCallback(
    async (
      text: string,
      options: { hiddenUserMessage?: boolean } = {},
    ): Promise<string | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;

      const userMsg: Message = { id: nextId(), role: "user", content: text };
      const previousConversation = conversationRef.current;
      const conversation = [...conversationRef.current, userMsg];
      const visibleMessages = options.hiddenUserMessage
        ? visibleMessagesRef.current
        : [...visibleMessagesRef.current, userMsg];
      conversationRef.current = conversation;
      visibleMessagesRef.current = visibleMessages;
      setView({
        messages: visibleMessages,
        streamingText: "",
        isStreaming: true,
        error: null,
      });
      const activeStream: StreamSession = {
        assistantId: nextId(),
        firstDeltaSeen: false,
        terminalReason: "streaming",
        text: "",
        truncated: false,
      };
      streamRef.current = activeStream;

      const appendDelta = (delta: string): void => {
        if (
          streamRef.current !== activeStream ||
          activeStream.terminalReason !== "streaming"
        ) {
          return;
        }

        activeStream.text += delta;

        // Paint the first token immediately; later ones batch on a frame.
        if (!activeStream.firstDeltaSeen) {
          activeStream.firstDeltaSeen = true;
          setView((current) => ({ ...current, streamingText: activeStream.text }));
          return;
        }

        if (activeStream.frameId !== undefined) return;
        activeStream.frameId = requestAnimationFrame(() => {
          activeStream.frameId = undefined;
          if (
            streamRef.current === activeStream &&
            activeStream.terminalReason === "streaming"
          ) {
            setView((current) => ({
              ...current,
              streamingText: activeStream.text,
            }));
          }
        });
      };

      await new Promise<void>((resolve) => {
        activeStream.resolve = resolve;
        activeStream.timeoutId = setTimeout(() => {
          if (streamRef.current !== activeStream) return;

          abortBackend("after a timeout");
          settleStream(
            activeStream,
            "error",
            "The model did not finish responding. Please try again.",
          );
        }, STREAM_TIMEOUT_MS);

        void streamPattern(conversation.slice(-MAX_CONTEXT_MESSAGES), appendDelta)
          .then(({ truncated }) => {
            activeStream.truncated = truncated;
            settleStream(activeStream, "done");
          })
          .catch((err: unknown) => {
            if (streamRef.current !== activeStream) return;
            settleStream(activeStream, "error", errorMessage(err));
          });
      });

      if (streamRef.current !== activeStream) return null;

      const rollback = (error: string | null): null => {
        conversationRef.current = previousConversation;
        setView({
          messages: visibleMessages,
          streamingText: "",
          isStreaming: false,
          error,
        });
        busyRef.current = false;
        streamRef.current = null;
        return null;
      };

      if (activeStream.terminalReason === "cancelled") return rollback(null);

      if (activeStream.terminalReason === "error") {
        return rollback(
          activeStream.error ?? "The request failed. Please try again.",
        );
      }

      const fullText = activeStream.text;
      const pattern = extractPattern(fullText);
      if (!pattern) {
        return rollback(
          activeStream.truncated
            ? "Gemini reached its output limit before completing the Strudel pattern. Please try again."
            : "Gemini returned no complete Strudel pattern. Please try again.",
        );
      }

      const assistantMsg: Message = {
        id: activeStream.assistantId,
        role: "assistant",
        content: fullText,
      };
      const finalConversation = [...conversation, assistantMsg];
      const finalVisibleMessages = [...visibleMessages, assistantMsg];
      conversationRef.current = finalConversation;
      visibleMessagesRef.current = finalVisibleMessages;
      setView({
        messages: finalVisibleMessages,
        streamingText: "",
        isStreaming: false,
        error: null,
      });
      busyRef.current = false;
      streamRef.current = null;

      return pattern;
    },
    [],
  );

  return {
    ...view,
    sendMessage,
    abortStream,
    clearChat,
  };
}

export function buildRetryMessage(code: string, error: string): string {
  return `The pattern you generated failed to evaluate with this error:\n\`\`\`\n${error}\n\`\`\`\nOriginal code:\n\`\`\`strudel\n${code}\n\`\`\`\nPlease fix the code. Remember: no variable declarations, no .play(), just a single Strudel expression.`;
}
