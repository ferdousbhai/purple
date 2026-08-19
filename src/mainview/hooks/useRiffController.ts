import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApiKeyStatus,
  SavePatternResult,
  TitleGenerationResult,
} from "../../shared/types";
import { getRandomStartupPattern, type StartupOptions } from "../../shared/cli";
import {
  clearApiKey as clearBackendApiKey,
  generateTitle,
  getApiKeyStatus,
  getStartupOptions,
  onStartupArgs,
  savePattern as saveBackendPattern,
  saveApiKey as saveBackendApiKey,
} from "../backend";
import { buildRetryMessage, useChat } from "./useChat";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { usePlayback } from "./usePlayback";
import { useTransitionSuggestions } from "./useTransitionSuggestions";

const MAX_RETRIES = 2;
type PromptMode = "play" | "stage" | "await-activation";
type TitleStatus = "idle" | "generating" | "ready" | "error";

interface TitleRequest {
  operation: number;
  patternReady: boolean;
  requestId: string;
  result: TitleGenerationResult | null;
}

interface PatternContext {
  code: string;
  sourcePrompt?: string;
}

/** Let a prompt run finish on its own, logging the rejection reason under `context`. */
function runInBackground(prompt: Promise<void>, context: string): void {
  void prompt.catch((promptError: unknown) => {
    console.error(`${context}:`, promptError);
  });
}

export function useRiffController() {
  const [code, setCode] = useState("");
  const [patternTitle, setPatternTitle] = useState("Startup Pattern");
  const [titleStatus, setTitleStatus] = useState<TitleStatus>("idle");
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleOperationRef = useRef(0);
  const titleRequestRef = useRef<TitleRequest | null>(null);
  const patternContextRef = useRef<PatternContext | null>(null);
  const [requiresUserActivation, setRequiresUserActivation] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({
    hasKey: false,
    source: "missing",
  });
  // Event listeners registered once still need the current key state.
  const apiKeyStatusRef = useRef(apiKeyStatus);
  apiKeyStatusRef.current = apiKeyStatus;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const chat = useChat();
  const playback = usePlayback();
  const nextMoves = useTransitionSuggestions();

  useKeyboardShortcuts({
    onStop: playback.stop,
    onAbort: chat.abortStream,
    isStreaming: chat.isStreaming,
  });

  const saveApiKey = useCallback(async (apiKey: string) => {
    setApiKeyStatus(await saveBackendApiKey(apiKey));
  }, []);

  const clearApiKey = useCallback(async () => {
    setApiKeyStatus(await clearBackendApiKey());
  }, []);

  const applyTitleResult = useCallback(
    (requestId: string, result: TitleGenerationResult) => {
      const request = titleRequestRef.current;
      if (
        !request ||
        request.requestId !== requestId ||
        request.operation !== titleOperationRef.current
      ) {
        return;
      }

      request.result = result;
      if (!request.patternReady) return;

      if (result.ok) {
        setPatternTitle(result.title);
        setTitleStatus("ready");
        setTitleError(null);
      } else {
        setTitleStatus("error");
        setTitleError(result.error);
      }
    },
    [],
  );

  const runPrompt = useCallback(
    async (text: string, mode: PromptMode = "play"): Promise<void> => {
      nextMoves.clear();
      const titleOperation = ++titleOperationRef.current;
      const titleRequestId = crypto.randomUUID();
      titleRequestRef.current = {
        operation: titleOperation,
        patternReady: false,
        requestId: titleRequestId,
        result: null,
      };

      // sendMessage dispatches the stream synchronously before yielding. Start
      // the independent title request immediately afterward so Gemini can run
      // both requests in parallel without delaying the primary dispatch.
      const patternPromise = chat.sendMessage(text);
      void generateTitle(text).then((result) =>
        applyTitleResult(titleRequestId, result),
      );

      const pattern = await patternPromise;
      if (!pattern) {
        if (titleOperation === titleOperationRef.current) {
          titleRequestRef.current = null;
          setTitleStatus("idle");
          setTitleError(null);
        }
        return;
      }

      const titleRequest = titleRequestRef.current;
      if (titleRequest?.requestId === titleRequestId) {
        titleRequest.patternReady = true;
      }
      setCode(pattern);
      patternContextRef.current = { code: pattern, sourcePrompt: text };
      setPatternTitle("");
      setTitleStatus("generating");
      setTitleError(null);
      if (titleRequest?.result) {
        applyTitleResult(titleRequestId, titleRequest.result);
      }
      if (mode !== "play") {
        setRequiresUserActivation(mode === "await-activation");
        return;
      }

      setRequiresUserActivation(false);
      const result =
        playback.playbackState === "playing"
          ? await playback.transition(pattern)
          : await playback.play(pattern);
      if (!result.ok && result.kind === "audio") {
        setRequiresUserActivation(true);
        // Still generate next-step suggestions so XFADE can appear after user activates audio.
        nextMoves.generate({ code: pattern, sourcePrompt: text });
        return;
      }
      if (result.ok) {
        nextMoves.generate({ code: pattern, sourcePrompt: text });
        return;
      }
      if (result.kind !== "evaluation") return;

      let lastError = result.error;
      let lastCode = pattern;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const fixedPattern = await chat.sendMessage(
          buildRetryMessage(lastCode, lastError),
          { hiddenUserMessage: true },
        );
        if (!fixedPattern) break;

        setCode(fixedPattern);
        patternContextRef.current = {
          code: fixedPattern,
          sourcePrompt: text,
        };
        const retryResult =
          playback.playbackState === "playing"
            ? await playback.transition(fixedPattern)
            : await playback.play(fixedPattern);
        if (retryResult.ok) {
          nextMoves.generate({ code: fixedPattern, sourcePrompt: text });
          break;
        }
        if (retryResult.kind === "audio") {
          setRequiresUserActivation(true);
          nextMoves.generate({ code: fixedPattern, sourcePrompt: text });
          break;
        }
        if (retryResult.kind !== "evaluation") break;

        lastError = retryResult.error;
        lastCode = fixedPattern;
      }
    },
    [
      applyTitleResult,
      chat.sendMessage,
      nextMoves.clear,
      nextMoves.generate,
      playback.play,
    ],
  );

  const sendMessage = useCallback(
    (text: string): boolean => {
      if (!apiKeyStatus.hasKey) {
        setIsSettingsOpen(true);
        return false;
      }
      if (
        playback.playbackState === "loading" ||
        playback.playbackState === "transitioning"
      ) {
        return false;
      }

      // Dispatch the model request first, then use the same input event to unlock audio.
      // Consistent with stageNext/presets: always stage as pending, require explicit XFADE/PLAY click.
      const prompt = runPrompt(text, "stage");
      void playback.prepareAudio();
      runInBackground(prompt, "[Chat] Prompt failed");
      return true;
    },
    [
      apiKeyStatus.hasKey,
      playback.playbackState,
      playback.prepareAudio,
      runPrompt,
    ],
  );

  const stageNext = useCallback(
    (text: string): boolean => {
      if (!apiKeyStatus.hasKey) {
        setIsSettingsOpen(true);
        return false;
      }
      if (playback.playbackState !== "playing") return false;

      runInBackground(
        runPrompt(text, "stage"),
        "[Chat] Could not stage next pattern",
      );
      return true;
    }, [apiKeyStatus.hasKey, playback.playbackState, runPrompt],
  );

  const play = useCallback(
    async (editorCode: string) => {
      setRequiresUserActivation(false);
      nextMoves.clear();
      const result = await playback.play(editorCode);
      if (result.ok) {
        const context = patternContextRef.current;
        nextMoves.generate({
          code: editorCode,
          sourcePrompt:
            context?.code === editorCode ? context.sourcePrompt : undefined,
        });
      }
      return result;
    },
    [nextMoves.clear, nextMoves.generate, playback.play],
  );

  const transition = useCallback(
    async (nextCode: string, durationCycles: number) => {
      setRequiresUserActivation(false);
      nextMoves.clear();
      const result = await playback.transition(nextCode, durationCycles);
      if (result.ok) {
        const context = patternContextRef.current;
        nextMoves.generate({
          code: nextCode,
          sourcePrompt:
            context?.code === nextCode ? context.sourcePrompt : undefined,
        });
      }
      return result;
    },
    [nextMoves.clear, nextMoves.generate, playback.transition],
  );

  const stop = useCallback(() => {
    nextMoves.clear();
    playback.stop();
  }, [nextMoves.clear, playback.stop]);

  const updatePatternTitle = useCallback((title: string) => {
    ++titleOperationRef.current;
    titleRequestRef.current = null;
    setPatternTitle(title);
    setTitleStatus(title.trim() ? "ready" : "idle");
    setTitleError(null);
  }, []);

  const savePattern = useCallback(
    (title: string, patternCode: string): Promise<SavePatternResult> =>
      saveBackendPattern(title, patternCode),
    [],
  );

  const applyStartupOptions = useCallback(
    (options: StartupOptions, hasKey: boolean): void => {
      if (options.error) {
        // The window is already open by the time arguments are parsed, so a bad
        // invocation cannot abort startup. Report it and open on a preset
        // instead of an empty editor.
        console.error(`[Startup] ${options.error}`);
        setCode(getRandomStartupPattern());
        setRequiresUserActivation(true);
        return;
      }
      if (options.initialCode) {
        setCode(options.initialCode);
        patternContextRef.current = { code: options.initialCode };
        setPatternTitle("Startup Pattern");
        setTitleStatus("ready");
        // Do not call playback.play() here. WebKitGTK does not opt this view
        // into audible autoplay, so AudioContext.resume() stays pending until a
        // trusted user gesture; awaiting it would deadlock playback in the
        // disabled "INIT..." state. Keep START enabled instead.
        setRequiresUserActivation(Boolean(options.requestPlayback));
        return;
      }
      if (!options.initialPrompt) return;
      if (!hasKey) {
        setIsSettingsOpen(true);
        return;
      }
      runInBackground(
        runPrompt(options.initialPrompt, "await-activation"),
        "[Startup] Initial prompt failed",
      );
    },
    [runPrompt],
  );

  useEffect(() => {
    let active = true;

    async function loadStartupState(): Promise<void> {
      try {
        const [status, options] = await Promise.all([
          getApiKeyStatus(),
          getStartupOptions(),
        ]);
        if (!active) return;

        setApiKeyStatus(status);
        applyStartupOptions(options, status.hasKey);
      } catch (startupError) {
        console.error("[Startup] Could not load startup state:", startupError);
      }
    }

    void loadStartupState();
    return () => {
      active = false;
    };
  }, [applyStartupOptions]);

  // A second `riff …` invocation focuses this window and forwards its arguments.
  useEffect(() => {
    let active = true;
    const unlisten = onStartupArgs((options) => {
      if (!active) return;
      applyStartupOptions(options, apiKeyStatusRef.current.hasKey);
    });

    return () => {
      active = false;
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [applyStartupOptions]);

  return {
    messages: chat.messages,
    streamingText: chat.streamingText,
    isStreaming: chat.isStreaming,
    chatError: chat.error,
    clearChat: chat.clearChat,
    abortStream: chat.abortStream,
    playbackState: playback.playbackState,
    error: playback.error,
    activeCode: playback.activeCode,
    activeRanges: playback.activeRanges,
    prepareAudio: playback.prepareAudio,
    stop,
    code,
    setCode,
    patternTitle,
    titleStatus,
    titleError,
    updatePatternTitle,
    savePattern,
    requiresUserActivation,
    apiKeyStatus,
    isSettingsOpen,
    setIsSettingsOpen,
    saveApiKey,
    clearApiKey,
    sendMessage,
    stageNext,
    transitionSuggestions: nextMoves.suggestions,
    transitionSuggestionsStatus: nextMoves.status,
    transitionSuggestionsError: nextMoves.error,
    play,
    transition,
  };
}
