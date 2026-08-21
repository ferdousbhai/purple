import { useState, useCallback, useRef, useEffect } from "react";
import {
  buildContextWindow,
  createFoldScheduler,
  type CompactionArtifact,
} from "@purple/core/compaction";
import { acceptRawPattern } from "@purple/core/pattern";
import {
  abortStream as abortBackendStream,
  errorMessage,
  generateCompactionSummary,
  streamPattern,
} from "../backend";
import type { Message } from "../../shared/types";

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

/** Fire-and-forget abort; a failed abort is only worth a diagnostic. */
function abortBackend(context: string): void {
  void reportFailedAbort(context);
}

async function reportFailedAbort(context: string): Promise<void> {
  try {
    await abortBackendStream();
  } catch (error) {
    console.error(`[Chat] Could not abort stream ${context}:`, error);
  }
}

interface ChatView {
  messages: Message[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
}

/**
 * The rolling state for background compaction: `artifact` covers the first
 * `coveredCount` messages of `conversationRef.current`. The fold protocol
 * itself (one summarizer call in flight, failure breaker, stale-result
 * checks) lives in the shared scheduler from `@purple/core/compaction`.
 */
interface CompactionState {
  artifact: CompactionArtifact | null;
  coveredCount: number;
  /** Gemini's reported prompt token count for the latest generation, or null
   * before the first one — the fold trigger's exact-size signal. */
  promptTokens: number | null;
}

function freshCompactionState(): CompactionState {
  return { artifact: null, coveredCount: 0, promptTokens: null };
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
  const compactionRef = useRef<CompactionState>(freshCompactionState());
  // Message ids are monotonic and never reset, so the prefix check rejects a
  // fold that settles after clearChat emptied and rebuilt the history.
  const [foldScheduler] = useState(() =>
    createFoldScheduler<Message>({
      summarize: generateCompactionSummary,
      isSameMessage: (a, b) => a.id === b.id,
      commit: (accept) => {
        const next = accept({
          messages: conversationRef.current,
          ...compactionRef.current,
        });
        if (next) {
          compactionRef.current = { ...compactionRef.current, ...next };
        }
      },
      onFoldFailed: (error) =>
        console.warn("[Chat] Background compaction failed:", error),
    }),
  );

  /**
   * Fold older history into the rolling summary in the background. Never
   * blocks a send: a send that happens mid-flight simply uses the previous
   * summary state, and `buildContextWindow` caps the uncovered tail.
   */
  const maybeCompact = useCallback(
    (conversation: Message[]): void => {
      foldScheduler.maybeFold({
        messages: conversation,
        ...compactionRef.current,
      });
    },
    [foldScheduler],
  );

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
    compactionRef.current = freshCompactionState();
    foldScheduler.reset();
    setView({ messages: [], streamingText: "", isStreaming: false, error: null });
    busyRef.current = false;
  }, [foldScheduler]);

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

      // Decoding a rejection reason happens here, at the `catch` that produced
      // it; the session only ever carries the finished message.
      const runStream = async (): Promise<void> => {
        try {
          const { artifact, coveredCount } = compactionRef.current;
          const { truncated, promptTokens } = await streamPattern(
            buildContextWindow(artifact, coveredCount, conversation),
            appendDelta,
          );
          activeStream.truncated = truncated;
          if (promptTokens !== null) {
            compactionRef.current = { ...compactionRef.current, promptTokens };
          }
          settleStream(activeStream, "done");
        } catch (error) {
          if (streamRef.current !== activeStream) return;
          settleStream(activeStream, "error", errorMessage(error));
        }
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

        // Dispatched synchronously: the async body runs up to its first await
        // before returning, so the request leaves before this executor yields.
        void runStream();
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
      const acceptance = acceptRawPattern(fullText);
      if (!acceptance.ok) {
        return rollback(
          activeStream.truncated
            ? "Gemini reached its output limit before completing the Strudel pattern. Please try again."
            : acceptance.error,
        );
      }
      const pattern = acceptance.pattern;

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

      maybeCompact(finalConversation);

      return pattern;
    },
    [maybeCompact],
  );

  return {
    ...view,
    sendMessage,
    abortStream,
    clearChat,
  };
}


