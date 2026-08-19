import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApiKeyStatus,
  PatternContext,
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
import type { EvalResult } from "../../shared/types";
import { attemptWithRepair } from "./patternRepair";
import { useChat } from "./useChat";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { usePlayback } from "./usePlayback";
import { useTransitionSuggestions } from "./useTransitionSuggestions";

type PromptMode = "stage" | "await-activation";
type TitleStatus = "idle" | "generating" | "ready" | "error";

/** One in-flight title generation. Identity is the token: only the request that
 * is still `titleRequestRef.current` may write title state. */
interface TitleRequest {
  patternReady: boolean;
  result: TitleGenerationResult | null;
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
  // The repair loop below reads playback state between async steps.
  const playbackStateRef = useRef(playback.playbackState);
  playbackStateRef.current = playback.playbackState;
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
    (request: TitleRequest, result: TitleGenerationResult) => {
      if (titleRequestRef.current !== request) return;

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

  /** Ask for next moves, attributing them to the prompt that produced `patternCode`. */
  const suggestNextMoves = useCallback(
    (patternCode: string) => {
      const context = patternContextRef.current;
      nextMoves.generate({
        code: patternCode,
        sourcePrompt:
          context?.code === patternCode ? context.sourcePrompt : undefined,
      });
    },
    [nextMoves.generate],
  );

  const runPrompt = useCallback(
    async (text: string, mode: PromptMode): Promise<void> => {
      nextMoves.clear();
      const titleRequest: TitleRequest = { patternReady: false, result: null };
      titleRequestRef.current = titleRequest;

      // sendMessage dispatches the stream synchronously before yielding. Start
      // the independent title request immediately afterward so Gemini can run
      // both requests in parallel without delaying the primary dispatch.
      const patternPromise = chat.sendMessage(text);
      void generateTitle(text).then((result) =>
        applyTitleResult(titleRequest, result),
      );

      const pattern = await patternPromise;
      if (!pattern) {
        if (titleRequestRef.current === titleRequest) {
          titleRequestRef.current = null;
          setTitleStatus("idle");
          setTitleError(null);
        }
        return;
      }

      titleRequest.patternReady = true;
      setCode(pattern);
      patternContextRef.current = { code: pattern, sourcePrompt: text };
      setPatternTitle("");
      setTitleStatus("generating");
      setTitleError(null);
      if (titleRequest.result) {
        applyTitleResult(titleRequest, titleRequest.result);
      }
      setRequiresUserActivation(mode === "await-activation");
    },
    [applyTitleResult, chat.sendMessage, nextMoves.clear],
  );

  /** Play or transition, repairing a generated pattern that fails to evaluate:
   * the error goes back to Gemini as a hidden message and each fix replays, up
   * to MAX_RETRIES times. This runs inside the user's PLAY/XFADE gesture, so
   * the audio context is already unlocked when a fix replays. */
  const runWithRepair = useCallback(
    async (
      code: string,
      attempt: (candidate: string) => Promise<EvalResult>,
    ): Promise<EvalResult> => {
      let context = patternContextRef.current;
      const outcome = await attemptWithRepair(code, {
        attempt,
        // Hand-edited code is not repaired; its error surfaces in the UI.
        isGeneratedPattern: (candidate) => context?.code === candidate,
        requestFix: (message) =>
          chat.sendMessage(message, { hiddenUserMessage: true }),
        applyFix: (fixed) => {
          context = { code: fixed, sourcePrompt: context?.sourcePrompt };
          patternContextRef.current = context;
          setCode(fixed);
        },
        // A newer prompt owns the editor now; leave its pattern alone.
        isStale: () => patternContextRef.current !== context,
        isStopped: () => playbackStateRef.current === "stopped",
      });
      if (outcome.result.ok) suggestNextMoves(outcome.code);
      return outcome.result;
    },
    [chat.sendMessage, suggestNextMoves],
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
      return runWithRepair(editorCode, playback.play);
    },
    [nextMoves.clear, playback.play, runWithRepair],
  );

  const transition = useCallback(
    async (nextCode: string, durationCycles: number) => {
      setRequiresUserActivation(false);
      nextMoves.clear();
      // transition() falls back to play() when nothing is playing yet, and a
      // failed transition lands back in "playing", so a repaired pattern can
      // re-attempt the same crossfade.
      return runWithRepair(nextCode, (candidate) =>
        playback.transition(candidate, durationCycles),
      );
    },
    [nextMoves.clear, playback.transition, runWithRepair],
  );

  const stop = useCallback(() => {
    nextMoves.clear();
    playback.stop();
  }, [nextMoves.clear, playback.stop]);

  const updatePatternTitle = useCallback((title: string) => {
    titleRequestRef.current = null;
    setPatternTitle(title);
    setTitleStatus(title.trim() ? "ready" : "idle");
    setTitleError(null);
  }, []);

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
    savePattern: saveBackendPattern,
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
