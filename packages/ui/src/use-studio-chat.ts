import { useState, useCallback, useRef, useEffect } from "react";
import {
  buildContextWindow,
  createFoldScheduler,
  shouldSuggestNewSession,
  type CompactionArtifact,
  type CompactionSummarizer,
} from "@purple/core/compaction";
import { errorMessage } from "@purple/core/error";
import { acceptRawPattern } from "@purple/core/pattern";
import type { ChatMessage, PatternStreamer } from "@purple/core/types";

export type StudioChatBackend = PatternStreamer & CompactionSummarizer;

export interface StudioChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface StudioChatState {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  artifact: CompactionArtifact | null;
  coveredCount: number;
}

export interface UseStudioChatOptions {
  initialState?: StudioChatState | null;
  onStateChange?: (state: StudioChatState) => void;
  onClear?: () => void;
  streamTimeoutMs?: number;
}

export interface SendMessageOptions {
  /** Run a model exchange without showing or persisting either side. Repairs
   * use this path, then replace the broken code in the original assistant turn. */
  transient?: boolean;
  /** Appended to the outbound request only; never shown or persisted. */
  requestInstruction?: string;
}

export function withRequestInstruction(
  messages: readonly ChatMessage[],
  instruction: string | undefined,
): ChatMessage[] {
  const requestInstruction = instruction?.trim();
  if (!requestInstruction || messages.length === 0) return [...messages];

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return [...messages, { role: "user", content: requestInstruction }];
  }
  return [
    ...messages.slice(0, -1),
    { ...last, content: `${last.content}\n\n${requestInstruction}` },
  ];
}

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

const DEFAULT_STREAM_TIMEOUT_MS = 90_000;

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
function abortBackend(
  abortStream: () => Promise<void>,
  context: string,
): void {
  void reportFailedAbort(abortStream, context);
}

async function reportFailedAbort(
  abortStream: () => Promise<void>,
  context: string,
): Promise<void> {
  try {
    await abortStream();
  } catch (error) {
    console.error(`[Chat] Could not abort stream ${context}:`, error);
  }
}

interface ChatView {
  messages: StudioChatMessage[];
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
   * before the first one - the fold trigger's exact-size signal. */
  promptTokens: number | null;
}

function freshCompactionState(): CompactionState {
  return { artifact: null, coveredCount: 0, promptTokens: null };
}

interface InitialSession {
  messages: StudioChatMessage[];
  compaction: CompactionState;
}

function initialSession(
  state: StudioChatState | null | undefined,
): InitialSession {
  const messages = (state?.messages ?? []).map((message, index) => ({
    ...message,
    id: String(index + 1),
  }));
  return {
    messages,
    compaction: {
      artifact: state?.artifact ?? null,
      coveredCount: Math.min(state?.coveredCount ?? 0, messages.length),
      promptTokens: null,
    },
  };
}

export function useStudioChat(
  backend: StudioChatBackend,
  options: UseStudioChatOptions = {},
) {
  const backendRef = useRef(backend);
  backendRef.current = backend;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [initial] = useState(() => initialSession(options.initialState));
  const [view, setView] = useState<ChatView>({
    messages: initial.messages,
    streamingText: "",
    isStreaming: false,
    error: null,
  });
  const visibleMessagesRef = useRef<StudioChatMessage[]>(initial.messages);
  const conversationRef = useRef<StudioChatMessage[]>(initial.messages);
  const busyRef = useRef(false);
  const idCounter = useRef(initial.messages.length);
  const streamRef = useRef<StreamSession | null>(null);
  const compactionRef = useRef<CompactionState>(initial.compaction);
  const undoRef = useRef<StudioChatState | null>(null);
  const [suggestNewSession, setSuggestNewSession] = useState(false);

  const refreshNewSessionSuggestion = useCallback((): void => {
    setSuggestNewSession(
      shouldSuggestNewSession(
        conversationRef.current.length,
        compactionRef.current.coveredCount,
        compactionRef.current.promptTokens,
      ),
    );
  }, []);

  const persist = useCallback((): void => {
    const { artifact, coveredCount } = compactionRef.current;
    optionsRef.current.onStateChange?.({
      messages: conversationRef.current.map(({ role, content }) => ({
        role,
        content,
      })),
      artifact,
      coveredCount,
    });
  }, []);

  // Message ids are monotonic and never reset, so the prefix check rejects a
  // fold that settles after clearChat emptied and rebuilt the history.
  const [foldScheduler] = useState(() =>
    createFoldScheduler<StudioChatMessage>({
      summarize: (previous, messages) =>
        backendRef.current.generateCompactionSummary(previous, messages),
      // A web repair may replace the latest assistant pattern in place. Treat
      // that as a changed prefix so an in-flight fold of the broken code cannot
      // commit over the repaired conversation.
      isSameMessage: (a, b) =>
        a.id === b.id && a.role === b.role && a.content === b.content,
      commit: (accept) => {
        const next = accept({
          messages: conversationRef.current,
          ...compactionRef.current,
        });
        if (next) {
          compactionRef.current = { ...compactionRef.current, ...next };
          refreshNewSessionSuggestion();
          persist();
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
    (conversation: StudioChatMessage[]): void => {
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
      abortBackend(backendRef.current.abortStream, "during cleanup");
    };
  }, []);

  const abortStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    abortBackend(backendRef.current.abortStream, "on request");
    settleStream(stream, "cancelled");
  }, []);

  const clearChat = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      abortBackend(backendRef.current.abortStream, "while clearing the chat");
      settleStream(stream, "cancelled");
      streamRef.current = null;
    }

    if (conversationRef.current.length > 0) {
      const { artifact, coveredCount } = compactionRef.current;
      undoRef.current = {
        messages: conversationRef.current.map(({ role, content }) => ({
          role,
          content,
        })),
        artifact,
        coveredCount,
      };
    }

    visibleMessagesRef.current = [];
    conversationRef.current = [];
    compactionRef.current = freshCompactionState();
    foldScheduler.reset();
    setSuggestNewSession(false);
    setView({ messages: [], streamingText: "", isStreaming: false, error: null });
    busyRef.current = false;
    optionsRef.current.onClear?.();
  }, [foldScheduler]);

  /**
   * Bring back the session the latest clearChat wiped, transcript and
   * compaction state together, and persist it again. Refuses once a new
   * conversation has started so a stale undo can never overwrite fresh chat.
   * Restored messages get fresh monotonic ids: ids never reset, so any fold
   * still in flight from before the clear fails its prefix check.
   */
  const undoClearChat = useCallback((): boolean => {
    const stash = undoRef.current;
    if (!stash || busyRef.current || conversationRef.current.length > 0) {
      return false;
    }
    undoRef.current = null;

    const messages = stash.messages.map((message) => ({
      ...message,
      id: nextId(),
    }));
    conversationRef.current = messages;
    visibleMessagesRef.current = messages;
    compactionRef.current = {
      artifact: stash.artifact,
      coveredCount: Math.min(stash.coveredCount, messages.length),
      promptTokens: null,
    };
    setView({ messages, streamingText: "", isStreaming: false, error: null });
    refreshNewSessionSuggestion();
    persist();
    return true;
  }, [persist, refreshNewSessionSuggestion]);

  const sendMessage = useCallback(
    async (
      text: string,
      sendOptions: SendMessageOptions = {},
    ): Promise<string | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;

      const userMsg: StudioChatMessage = {
        id: nextId(),
        role: "user",
        content: text,
      };
      const previousConversation = conversationRef.current;
      const conversation = [...conversationRef.current, userMsg];
      const visibleMessages = sendOptions.transient
        ? visibleMessagesRef.current
        : [...visibleMessagesRef.current, userMsg];
      if (!sendOptions.transient) conversationRef.current = conversation;
      visibleMessagesRef.current = visibleMessages;
      if (!sendOptions.transient) persist();
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
        if (sendOptions.transient) return;

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
          const { truncated, promptTokens } = await backendRef.current.stream(
            withRequestInstruction(
              buildContextWindow(artifact, coveredCount, conversation),
              sendOptions.requestInstruction,
            ),
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

          abortBackend(backendRef.current.abortStream, "after a timeout");
          settleStream(
            activeStream,
            "error",
            "The model did not finish responding. Please try again.",
          );
        }, optionsRef.current.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS);

        // Dispatched synchronously: the async body runs up to its first await
        // before returning, so the request leaves before this executor yields.
        void runStream();
      });

      if (streamRef.current !== activeStream) return null;

      const finishFailedStream = (error: string | null): null => {
        conversationRef.current =
          sendOptions.transient ? previousConversation : conversation;
        refreshNewSessionSuggestion();
        setView({
          messages: visibleMessages,
          streamingText: "",
          isStreaming: false,
          error: sendOptions.transient ? null : error,
        });
        busyRef.current = false;
        streamRef.current = null;
        if (!sendOptions.transient) persist();
        return null;
      };

      if (activeStream.terminalReason === "cancelled") {
        return finishFailedStream(null);
      }

      if (activeStream.terminalReason === "error") {
        return finishFailedStream(
          activeStream.error ?? "The request failed. Please try again.",
        );
      }

      const fullText = activeStream.text;
      const acceptance = acceptRawPattern(fullText);
      if (!acceptance.ok) {
        return finishFailedStream(
          activeStream.truncated
            ? "Gemini reached its output limit before completing the Strudel pattern. Please try again."
            : acceptance.error,
        );
      }
      const pattern = acceptance.pattern;

      if (sendOptions.transient) {
        setView({
          messages: visibleMessages,
          streamingText: "",
          isStreaming: false,
          error: null,
        });
        busyRef.current = false;
        streamRef.current = null;
        return pattern;
      }

      const assistantMsg: StudioChatMessage = {
        id: activeStream.assistantId,
        role: "assistant",
        content: fullText,
      };
      const finalConversation = [...conversation, assistantMsg];
      const finalVisibleMessages = [...visibleMessages, assistantMsg];
      conversationRef.current = finalConversation;
      visibleMessagesRef.current = finalVisibleMessages;
      refreshNewSessionSuggestion();
      setView({
        messages: finalVisibleMessages,
        streamingText: "",
        isStreaming: false,
        error: null,
      });
      busyRef.current = false;
      streamRef.current = null;
      persist();

      maybeCompact(finalConversation);

      return pattern;
    },
    [maybeCompact, persist, refreshNewSessionSuggestion],
  );

  const replaceLastAssistantPattern = useCallback(
    (broken: string, fixed: string): void => {
      const last = conversationRef.current[conversationRef.current.length - 1];
      if (
        !last ||
        last.role !== "assistant" ||
        !last.content.includes(broken)
      ) {
        return;
      }

      const replacement = {
        ...last,
        content: last.content.replace(broken, fixed),
      };
      conversationRef.current = [
        ...conversationRef.current.slice(0, -1),
        replacement,
      ];
      visibleMessagesRef.current = visibleMessagesRef.current.map((message) =>
        message.id === last.id ? replacement : message,
      );
      setView((current) => ({
        ...current,
        messages: visibleMessagesRef.current,
      }));
      persist();
    },
    [persist],
  );

  return {
    ...view,
    sendMessage,
    abortStream,
    clearChat,
    undoClearChat,
    suggestNewSession,
    replaceLastAssistantPattern,
  };
}
