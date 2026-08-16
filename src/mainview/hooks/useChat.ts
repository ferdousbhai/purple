import { useState, useCallback, useRef, useEffect } from "react";
import { extractPattern } from "@riff/core/pattern";
import { electroview, setStreamHandler } from "../rpc";
import { MAX_CONTEXT_MESSAGES, type Message } from "../../shared/types";

interface StreamSession {
  assistantId: string;
  firstDeltaSeen: boolean;
  frameId?: number;
  requestId: string;
  resolve?: () => void;
  startedAt: number;
  terminalReason: "streaming" | "done" | "error" | "cancelled" | "timeout";
  text: string;
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

export function useChat() {
  const [view, setView] = useState({
    messages: [] as Message[],
    streamingText: "",
    isStreaming: false,
    error: null as string | null,
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
    setStreamHandler({
      onDelta: (requestId, delta) => {
        const stream = streamRef.current;
        if (
          !stream ||
          stream.requestId !== requestId ||
          stream.terminalReason !== "streaming"
        )
          return;

        if (!stream.firstDeltaSeen) {
          stream.firstDeltaSeen = true;
          console.log(
            `[Chat] First token in ${Math.round(performance.now() - stream.startedAt)}ms`,
          );
          stream.text += delta;
          setView((current) => ({ ...current, streamingText: stream.text }));
          return;
        }

        stream.text += delta;
        if (stream.frameId !== undefined) return;
        stream.frameId = requestAnimationFrame(() => {
          stream.frameId = undefined;
          if (
            streamRef.current === stream &&
            stream.terminalReason === "streaming"
          ) {
            setView((current) => ({ ...current, streamingText: stream.text }));
          }
        });
      },
      onDone: (requestId) => {
        const stream = streamRef.current;
        if (
          stream?.requestId === requestId &&
          stream.terminalReason === "streaming"
        ) {
          settleStream(stream, "done");
        }
      },
      onError: (requestId, error) => {
        const stream = streamRef.current;
        if (
          !stream ||
          stream.requestId !== requestId ||
          stream.terminalReason !== "streaming"
        )
          return;

        settleStream(stream, "error", error);
      },
    });

    return () => {
      setStreamHandler({});

      const stream = streamRef.current;
      if (!stream) return;

      settleStream(stream, "cancelled");
      streamRef.current = null;
      busyRef.current = false;
      void electroview.rpc!.request
        .abortStream({ requestId: stream.requestId })
        .catch((error: unknown) => {
          console.error("[Chat] Could not abort stream during cleanup:", error);
        });
    };
  }, []);

  const abortStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    void electroview.rpc!.request
      .abortStream({ requestId: stream.requestId })
      .catch((error: unknown) => {
        console.error("[Chat] Could not abort stream:", error);
      });
    settleStream(stream, "cancelled");
  }, []);

  const clearChat = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      void electroview.rpc!.request
        .abortStream({ requestId: stream.requestId })
        .catch((error: unknown) => {
          console.error("[Chat] Could not abort stream:", error);
        });
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
      const startedAt = performance.now();
      const submittedAtMs = Date.now();

      const userMsg: Message = { id: nextId(), role: "user", content: text };
      const previousConversation = conversationRef.current;
      const conversation = [...conversationRef.current, userMsg];
      const visibleMessages = options.hiddenUserMessage
        ? visibleMessagesRef.current
        : [...visibleMessagesRef.current, userMsg];
      conversationRef.current = conversation;
      visibleMessagesRef.current = visibleMessages;
      setView({
        messages: [...visibleMessages],
        streamingText: "",
        isStreaming: true,
        error: null,
      });
      const activeStream: StreamSession = {
        assistantId: nextId(),
        firstDeltaSeen: false,
        requestId: crypto.randomUUID(),
        startedAt,
        terminalReason: "streaming",
        text: "",
      };
      streamRef.current = activeStream;

      await new Promise<void>((resolve) => {
        activeStream.resolve = resolve;
        activeStream.timeoutId = setTimeout(() => {
          if (streamRef.current !== activeStream) return;

          void electroview.rpc!.request
            .abortStream({ requestId: activeStream.requestId })
            .catch(() => {});
          settleStream(
            activeStream,
            "timeout",
            "The model did not finish responding. Please try again.",
          );
        }, STREAM_TIMEOUT_MS);
        electroview
          .rpc!.request.startStream({
            requestId: activeStream.requestId,
            messages: conversation.slice(-MAX_CONTEXT_MESSAGES),
            submittedAtMs,
          })
          .catch((err: unknown) => {
            if (streamRef.current !== activeStream) return;

            settleStream(
              activeStream,
              "error",
              err instanceof Error ? err.message : String(err),
            );
          });
      });

      if (streamRef.current !== activeStream) return null;

      if (activeStream.terminalReason === "cancelled") {
        conversationRef.current = previousConversation;
        setView({
          messages: visibleMessages,
          streamingText: "",
          isStreaming: false,
          error: null,
        });
        busyRef.current = false;
        streamRef.current = null;
        return null;
      }

      if (
        activeStream.terminalReason === "error" ||
        activeStream.terminalReason === "timeout"
      ) {
        conversationRef.current = previousConversation;
        setView({
          messages: visibleMessages,
          streamingText: "",
          isStreaming: false,
          error: activeStream.error ?? "The request failed. Please try again.",
        });
        busyRef.current = false;
        streamRef.current = null;
        return null;
      }

      const fullText = activeStream.text;
      const pattern = extractPattern(fullText);
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
