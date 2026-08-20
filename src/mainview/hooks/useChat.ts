import { useState, useCallback, useRef, useEffect } from "react";
import {
  buildContextWindow,
  planCompaction,
  type CompactionArtifact,
} from "@riff/core/compaction";
import { extractPattern } from "@riff/core/pattern";
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
 * The rolling state for background compaction. `artifact` covers the first
 * `coveredCount` messages of `conversationRef.current`; `inFlight` keeps at
 * most one summarizer call running at a time.
 */
interface CompactionState {
  artifact: CompactionArtifact | null;
  coveredCount: number;
  inFlight: boolean;
}

function freshCompactionState(): CompactionState {
  return { artifact: null, coveredCount: 0, inFlight: false };
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

  /**
   * Fold older history into the rolling summary in the background. Never
   * blocks a send: a send that happens mid-flight simply uses the previous
   * summary state, and `buildContextWindow` caps the uncovered tail.
   */
  const maybeCompact = useCallback((conversation: Message[]): void => {
    const state = compactionRef.current;
    if (state.inFlight) return;

    const plan = planCompaction(conversation.length, state.coveredCount);
    if (!plan.fold) return;

    const startCovered = state.coveredCount;
    const folded = conversation.slice(0, plan.foldEnd);
    state.inFlight = true;
    void generateCompactionSummary(
      state.artifact,
      folded.slice(startCovered),
    ).then((result) => {
      state.inFlight = false;
      if (!result.ok) {
        console.warn("[Chat] Background compaction failed:", result.error);
        return;
      }

      // Accept the summary only if the messages it covers are still a
      // prefix of the live conversation (clearChat swaps the state object
      // and empties the history, so a stale result lands nowhere).
      if (compactionRef.current !== state) return;
      if (state.coveredCount !== startCovered) return;
      const live = conversationRef.current;
      if (live.length < folded.length) return;
      for (let index = 0; index < folded.length; index += 1) {
        if (live[index]?.id !== folded[index]?.id) return;
      }

      state.artifact = result.artifact;
      state.coveredCount = folded.length;
    });
  }, []);

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
    // A fresh object: an in-flight summarizer call holds the old one and
    // its result is discarded against this new state.
    compactionRef.current = freshCompactionState();
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

      // Decoding a rejection reason happens here, at the `catch` that produced
      // it; the session only ever carries the finished message.
      const runStream = async (): Promise<void> => {
        try {
          const { artifact, coveredCount } = compactionRef.current;
          const { truncated } = await streamPattern(
            buildContextWindow(artifact, coveredCount, conversation),
            appendDelta,
          );
          activeStream.truncated = truncated;
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


