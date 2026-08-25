import { useState, useCallback, useRef, useEffect } from "react";
import {
  buildContextWindow,
  createFoldScheduler,
  shouldSuggestNewSession,
  type CompactionArtifact,
  type CompactionSummarizer,
} from "@purple/core/compaction";
import { errorMessage } from "@purple/core/error";
import type { ChatMessage, PatternStreamer } from "@purple/core/types";
import {
  formatGeneratedTurn,
  type GeneratedTurn,
} from "@purple/core/turn";

export type StudioChatBackend = PatternStreamer & CompactionSummarizer & {
  abortCompaction?(): void;
};

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
  /** Appended to the outbound request only; never shown or persisted. */
  requestInstruction?: string;
  /** Paint the decoded pattern prefix without treating it as generated code yet. */
  onPatternPreview?: (pattern: string) => void;
  /** Restore the editor snapshot when generation fails before it can commit. */
  onPatternPreviewDiscarded?: () => void;
  /** Validate and repair the complete pattern while metadata keeps streaming. */
  resolvePattern?: (pattern: string) => string | Promise<string>;
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
  discardPatternPreview?: () => void;
  resolve?: () => void;
  terminalReason: "streaming" | "done" | "error" | "cancelled";
  previewText: string;
  patternComplete: boolean;
  patternResolution?: Promise<PatternResolution>;
  turn?: GeneratedTurn;
  error?: string;
  timeoutId?: ReturnType<typeof setTimeout>;
}

type PatternResolution =
  | { ok: true; pattern: string }
  | { ok: false; error: string };

function fallbackTurn(pattern: string): GeneratedTurn {
  return {
    pattern,
    progression: null,
    title: null,
    suggestions: [],
    explanation: "",
  };
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
  if (reason !== "done") discardPatternPreview(stream);
  stream.resolve?.();
}

function cancelStreamSession(stream: StreamSession): void {
  if (stream.terminalReason === "streaming") {
    settleStream(stream, "cancelled");
    return;
  }
  if (stream.terminalReason === "done") {
    stream.terminalReason = "cancelled";
    discardPatternPreview(stream);
  }
}

function streamWasCancelled(stream: StreamSession): boolean {
  return stream.terminalReason === "cancelled";
}

function discardPatternPreview(stream: StreamSession): void {
  const discard = stream.discardPatternPreview;
  stream.discardPatternPreview = undefined;
  discard?.();
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
    isStreaming: false,
    error: null,
  });
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
   * summary state, and `buildContextWindow` keeps the uncovered tail intact.
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
      foldScheduler.reset();
      backendRef.current.abortCompaction?.();
      const stream = streamRef.current;
      if (!stream) return;

      cancelStreamSession(stream);
      streamRef.current = null;
      busyRef.current = false;
      abortBackend(backendRef.current.abortStream, "during cleanup");
    };
  }, [foldScheduler]);

  const abortStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    abortBackend(backendRef.current.abortStream, "on request");
    cancelStreamSession(stream);
  }, []);

  const clearChat = useCallback(() => {
    backendRef.current.abortCompaction?.();
    const stream = streamRef.current;
    if (stream) {
      abortBackend(backendRef.current.abortStream, "while clearing the chat");
      cancelStreamSession(stream);
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

    conversationRef.current = [];
    compactionRef.current = freshCompactionState();
    foldScheduler.reset();
    setSuggestNewSession(false);
    setView({ messages: [], isStreaming: false, error: null });
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
    compactionRef.current = {
      artifact: stash.artifact,
      coveredCount: Math.min(stash.coveredCount, messages.length),
      promptTokens: null,
    };
    setView({ messages, isStreaming: false, error: null });
    refreshNewSessionSuggestion();
    persist();
    return true;
  }, [persist, refreshNewSessionSuggestion]);

  const sendMessage = useCallback(
    async (
      text: string,
      sendOptions: SendMessageOptions = {},
    ): Promise<GeneratedTurn | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;

      const userMsg: StudioChatMessage = {
        id: nextId(),
        role: "user",
        content: text,
      };
      const conversation = [...conversationRef.current, userMsg];
      conversationRef.current = conversation;
      persist();
      setView({
        messages: conversation,
        isStreaming: true,
        error: null,
      });
      const activeStream: StreamSession = {
        assistantId: nextId(),
        firstDeltaSeen: false,
        discardPatternPreview: sendOptions.onPatternPreviewDiscarded,
        terminalReason: "streaming",
        previewText: "",
        patternComplete: false,
      };
      streamRef.current = activeStream;

      const paintPreview = (): void => {
        sendOptions.onPatternPreview?.(activeStream.previewText);
      };

      const appendPatternDelta = (delta: string): void => {
        if (
          streamRef.current !== activeStream ||
          activeStream.terminalReason !== "streaming"
        ) {
          return;
        }

        activeStream.previewText += delta;
        if (!sendOptions.onPatternPreview) return;

        // Paint the first decoded token immediately; later ones batch by frame
        // so CodeMirror does not rebuild for every network chunk.
        if (!activeStream.firstDeltaSeen) {
          activeStream.firstDeltaSeen = true;
          paintPreview();
          return;
        }

        if (activeStream.frameId !== undefined) return;
        activeStream.frameId = requestAnimationFrame(() => {
          activeStream.frameId = undefined;
          if (
            streamRef.current === activeStream &&
            activeStream.terminalReason === "streaming"
          ) {
            paintPreview();
          }
        });
      };

      const completePattern = (pattern: string): void => {
        if (
          streamRef.current !== activeStream ||
          activeStream.terminalReason !== "streaming" ||
          activeStream.patternComplete
        ) {
          return;
        }
        activeStream.patternComplete = true;
        activeStream.previewText = pattern;
        if (activeStream.frameId !== undefined) {
          cancelAnimationFrame(activeStream.frameId);
          activeStream.frameId = undefined;
        }
        paintPreview();

        try {
          const resolution = sendOptions.resolvePattern?.(pattern) ?? pattern;
          activeStream.patternResolution = Promise.resolve(resolution).then(
            (resolved) => ({ ok: true, pattern: resolved }),
            (cause: unknown) => ({ ok: false, error: errorMessage(cause) }),
          );
        } catch (cause) {
          activeStream.patternResolution = Promise.resolve({
            ok: false,
            error: errorMessage(cause),
          });
        }
      };

      // Decoding a rejection reason happens here, at the `catch` that produced
      // it; the session only ever carries the finished message.
      const runStream = async (): Promise<void> => {
        try {
          const { artifact, coveredCount } = compactionRef.current;
          const { turn, promptTokens } = await backendRef.current.stream(
            withRequestInstruction(
              buildContextWindow(artifact, coveredCount, conversation),
              sendOptions.requestInstruction,
            ),
            {
              onPatternDelta: appendPatternDelta,
              onPatternComplete: completePattern,
            },
          );
          if (
            streamRef.current !== activeStream ||
            activeStream.terminalReason !== "streaming"
          ) {
            return;
          }
          activeStream.turn = turn;
          compactionRef.current = { ...compactionRef.current, promptTokens };
          settleStream(activeStream, "done");
        } catch (error) {
          if (streamRef.current !== activeStream) return;
          // Once a complete pattern is available, metadata is best-effort. A
          // dropped or malformed tail must not discard music already being
          // validated and repaired locally.
          if (activeStream.patternComplete) {
            activeStream.turn = fallbackTurn(activeStream.previewText);
            settleStream(activeStream, "done");
          } else {
            settleStream(activeStream, "error", errorMessage(error));
          }
        }
      };

      await new Promise<void>((resolve) => {
        activeStream.resolve = resolve;
        activeStream.timeoutId = setTimeout(() => {
          if (streamRef.current !== activeStream) return;

          abortBackend(backendRef.current.abortStream, "after a timeout");
          if (activeStream.patternComplete) {
            activeStream.turn = fallbackTurn(activeStream.previewText);
            settleStream(activeStream, "done");
          } else {
            settleStream(
              activeStream,
              "error",
              "The model did not finish responding. Please try again.",
            );
          }
        }, optionsRef.current.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS);

        // Dispatched synchronously: the async body runs up to its first await
        // before returning, so the request leaves before this executor yields.
        void runStream();
      });

      if (streamRef.current !== activeStream) return null;

      const finishFailedStream = (error: string | null): null => {
        discardPatternPreview(activeStream);
        conversationRef.current = conversation;
        refreshNewSessionSuggestion();
        setView({
          messages: conversation,
          isStreaming: false,
          error,
        });
        busyRef.current = false;
        streamRef.current = null;
        persist();
        return null;
      };

      if (streamWasCancelled(activeStream)) {
        return finishFailedStream(null);
      }

      if (activeStream.terminalReason === "error") {
        return finishFailedStream(
          activeStream.error ?? "The request failed. Please try again.",
        );
      }

      const streamedTurn = activeStream.turn;
      if (!streamedTurn) {
        return finishFailedStream("Gemini did not return a valid Strudel pattern.");
      }
      const resolution = activeStream.patternResolution
        ? await activeStream.patternResolution
        : { ok: true as const, pattern: streamedTurn.pattern };
      if (streamRef.current !== activeStream) return null;
      if (streamWasCancelled(activeStream)) {
        return finishFailedStream(null);
      }
      if (!resolution.ok) return finishFailedStream(resolution.error);
      const turn = { ...streamedTurn, pattern: resolution.pattern };

      const fullText = formatGeneratedTurn(turn);
      const assistantMsg: StudioChatMessage = {
        id: activeStream.assistantId,
        role: "assistant",
        content: fullText,
      };
      const finalConversation = [...conversation, assistantMsg];
      conversationRef.current = finalConversation;
      refreshNewSessionSuggestion();
      setView({
        messages: finalConversation,
        isStreaming: false,
        error: null,
      });
      busyRef.current = false;
      streamRef.current = null;
      persist();

      maybeCompact(finalConversation);

      return turn;
    },
    [maybeCompact, persist, refreshNewSessionSuggestion],
  );

  const replaceLastAssistantPattern = useCallback(
    (broken: string, fixed: string): void => {
      const stream = streamRef.current;
      if (stream?.patternComplete) {
        const pendingResolution =
          stream.patternResolution ??
          Promise.resolve({
            ok: true as const,
            pattern: stream.previewText,
          });
        stream.patternResolution = pendingResolution.then((resolution) =>
          resolution.ok && resolution.pattern === broken
            ? { ok: true, pattern: fixed }
            : resolution,
        );
      }

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
      const { artifact, coveredCount } = compactionRef.current;
      if (artifact && conversationRef.current.length <= coveredCount) {
        compactionRef.current = {
          ...compactionRef.current,
          artifact: { ...artifact, latestPattern: fixed },
        };
      }
      setView((current) => ({
        ...current,
        messages: conversationRef.current,
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
