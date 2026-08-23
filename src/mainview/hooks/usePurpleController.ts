import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApiKeyStatus,
  TitleGenerationResult,
} from "../../shared/types";
import { getRandomStartupPattern, type StartupOptions } from "../../shared/cli";
import {
  backend,
  clearApiKey as clearBackendApiKey,
  getApiKeyStatus,
  getStartupOptions,
  onMediaControl,
  onStartupArgs,
  savePattern as saveBackendPattern,
  saveApiKey as saveBackendApiKey,
  setPlaybackState as reportPlaybackState,
} from "../backend";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { EXPLANATORY_STYLE_INSTRUCTION } from "@purple/core/prompts";
import { useGeneratedPattern } from "@purple/ui/use-generated-pattern";
import { usePlayback } from "@purple/ui/use-playback";
import { useStudioChat } from "@purple/ui/use-studio-chat";
import { useTransitionSuggestions } from "@purple/ui/use-transition-suggestions";
import { requireRunningAudioContext } from "../audio-activation";

type PromptMode = "stage" | "await-activation";

const DESKTOP_AUDIO_OPTIONS = {
  ensureRunningContext: requireRunningAudioContext,
};
type TitleStatus = "idle" | "generating" | "ready" | "error";

const GENERATED_PATTERN_ERROR =
  "Purple could not produce a playable pattern. Try describing the change another way.";
const TRANSITION_ERROR =
  "The crossfade could not complete. Use Play to resume if playback stopped.";

/** One in-flight title generation. Identity is the token: only the request that
 * is still `titleRequestRef.current` may write title state. */
interface TitleRequest {
  patternReady: boolean;
  result: TitleGenerationResult | null;
}

/** Let a prompt run finish on its own, logging the rejection reason under `context`. */
function runInBackground(prompt: Promise<void>, context: string): void {
  void reportRejection(prompt, context);
}

async function reportRejection(
  prompt: Promise<void>,
  context: string,
): Promise<void> {
  try {
    await prompt;
  } catch (error) {
    console.error(`${context}:`, error);
  }
}

export function usePurpleController() {
  const [code, setCode] = useState("");
  const [patternTitle, setPatternTitle] = useState("Startup Pattern");
  const [titleStatus, setTitleStatus] = useState<TitleStatus>("idle");
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleRequestRef = useRef<TitleRequest | null>(null);
  const [requiresUserActivation, setRequiresUserActivation] = useState(false);
  const [generatedPlaybackError, setGeneratedPlaybackError] = useState<
    string | null
  >(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({
    hasKey: false,
    source: "missing",
  });
  // Event listeners registered once still need the current key state.
  const apiKeyStatusRef = useRef(apiKeyStatus);
  apiKeyStatusRef.current = apiKeyStatus;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const chat = useStudioChat(backend);
  // The WebKitGTK activation quirks (non-standard "interrupted" state, silent
  // output until primed) stay desktop-side, injected into the shared engine.
  const playback = usePlayback(DESKTOP_AUDIO_OPTIONS);
  // The repair loop below reads playback state between async steps.
  const playbackStateRef = useRef(playback.playbackState);
  playbackStateRef.current = playback.playbackState;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const explanatoryStyleRef = useRef(false);
  const nextMoves = useTransitionSuggestions(backend);
  const generatedPattern = useGeneratedPattern({
    validatePattern: playback.validatePattern,
    requestFix: (message) =>
      chat.sendMessage(message, {
        hiddenUserMessage: true,
        requestInstruction: explanatoryStyleRef.current
          ? EXPLANATORY_STYLE_INSTRUCTION
          : undefined,
      }),
    onCodeChange: setCode,
    playingRevision: {
      getPlayingCode: () => {
        const current = playbackRef.current;
        return current.playbackState === "playing" ? current.activeCode : null;
      },
      replace: async (fixed) => {
        const result = await playbackRef.current.play(fixed, {
          reportEvaluationError: false,
        });
        if (!result.ok && result.kind === "evaluation") {
          setGeneratedPlaybackError(GENERATED_PATTERN_ERROR);
        }
        return result;
      },
    },
    getStopToken: playback.getStopToken,
    onPlaybackSuccess: (patternCode, sourcePrompt) =>
      nextMoves.generate({ code: patternCode, sourcePrompt }),
    onValidationProblems: (problems) =>
      console.warn(
        "[Validate] Pattern still has problems after repair:",
        problems,
      ),
  });

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

  const runPrompt = useCallback(
    async (
      text: string,
      mode: PromptMode,
      explanatoryStyle = false,
    ): Promise<void> => {
      nextMoves.clear();
      setGeneratedPlaybackError(null);
      explanatoryStyleRef.current = explanatoryStyle;
      const titleRequest: TitleRequest = { patternReady: false, result: null };
      titleRequestRef.current = titleRequest;

      // sendMessage dispatches the stream synchronously before yielding. Start
      // the independent title request immediately afterward so Gemini can run
      // both requests in parallel without delaying the primary dispatch.
      const patternPromise = chat.sendMessage(text, {
        requestInstruction: explanatoryStyle
          ? EXPLANATORY_STYLE_INSTRUCTION
          : undefined,
      });
      void backend.generateTitle(text).then((result) =>
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
      generatedPattern.adopt(pattern, text);
      setPatternTitle("");
      setTitleStatus("generating");
      setTitleError(null);
      if (titleRequest.result) {
        applyTitleResult(titleRequest, titleRequest.result);
      }
      setRequiresUserActivation(mode === "await-activation");
      runInBackground(
        generatedPattern.validate(pattern).then(() => undefined),
        "[Validate] Pattern validation failed",
      );
    },
    [
      applyTitleResult,
      chat.sendMessage,
      generatedPattern.adopt,
      generatedPattern.validate,
      nextMoves.clear,
    ],
  );

  const sendMessage = useCallback(
    (text: string, explanatoryStyle = false): boolean => {
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
      const prompt = runPrompt(text, "stage", explanatoryStyle);
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
    (text: string, explanatoryStyle = false): boolean => {
      if (!apiKeyStatus.hasKey) {
        setIsSettingsOpen(true);
        return false;
      }
      if (playback.playbackState !== "playing") return false;

      runInBackground(
        runPrompt(text, "stage", explanatoryStyle),
        "[Chat] Could not stage next pattern",
      );
      return true;
    }, [apiKeyStatus.hasKey, playback.playbackState, runPrompt],
  );

  const play = useCallback(
    async (editorCode: string) => {
      setRequiresUserActivation(false);
      setGeneratedPlaybackError(null);
      nextMoves.clear();
      const generated = generatedPattern.isCurrent(editorCode);
      const outcome = await generatedPattern.attempt(editorCode, (candidate) =>
        playback.play(candidate, {
          reportEvaluationError: generated ? false : undefined,
        }),
      );
      if (
        generated &&
        !outcome.result.ok &&
        outcome.result.kind === "evaluation"
      ) {
        setGeneratedPlaybackError(GENERATED_PATTERN_ERROR);
      }
      return outcome.result;
    },
    [
      generatedPattern.attempt,
      generatedPattern.isCurrent,
      nextMoves.clear,
      playback.play,
    ],
  );

  const transition = useCallback(
    async (nextCode: string, durationCycles: number) => {
      setRequiresUserActivation(false);
      setGeneratedPlaybackError(null);
      nextMoves.clear();
      // transition() falls back to play() when nothing is playing yet, and a
      // failed transition lands back in "playing", so a repaired pattern can
      // re-attempt the same crossfade.
      const generated = generatedPattern.isCurrent(nextCode);
      let candidateCode = nextCode;
      const playingBeforeValidation =
        playbackRef.current.playbackState === "playing"
          ? playbackRef.current.activeCode
          : null;
      if (generated) {
        const validated = await generatedPattern.validate(nextCode);
        if (validated.problems.length > 0) {
          setGeneratedPlaybackError(GENERATED_PATTERN_ERROR);
          return {
            ok: false,
            kind: "evaluation",
            error: GENERATED_PATTERN_ERROR,
          } as const;
        }
        candidateCode = validated.code;
        if (
          playingBeforeValidation !== null &&
          (playbackRef.current.playbackState !== "playing" ||
            playbackRef.current.activeCode !== playingBeforeValidation)
        ) {
          return { ok: false, kind: "cancelled" } as const;
        }
      }
      let transitionFailed = false;
      const outcome = await generatedPattern.attempt(
        candidateCode,
        async (candidate) => {
          const result = await playback.transition(candidate, durationCycles, {
            reportEvaluationError: generated ? false : undefined,
          });
          if (
            !result.ok &&
            result.kind === "evaluation" &&
            result.source === "transition"
          ) {
            transitionFailed = true;
            return { ok: false, kind: "cancelled" };
          }
          return result;
        },
      );
      if (transitionFailed) {
        setGeneratedPlaybackError(TRANSITION_ERROR);
      } else if (
        generated &&
        !outcome.result.ok &&
        outcome.result.kind === "evaluation"
      ) {
        setGeneratedPlaybackError(GENERATED_PATTERN_ERROR);
      }
      return outcome.result;
    },
    [
      generatedPattern.attempt,
      generatedPattern.isCurrent,
      generatedPattern.validate,
      nextMoves.clear,
      playback.transition,
    ],
  );

  const stop = useCallback(() => {
    nextMoves.clear();
    setGeneratedPlaybackError(null);
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
        generatedPattern.adopt(options.initialCode);
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
    [generatedPattern.adopt, runPrompt],
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

  // Keep the desktop's media controls (MPRIS) in sync with playback.
  useEffect(() => {
    reportPlaybackState(playback.playbackState, patternTitle);
  }, [playback.playbackState, patternTitle]);

  // Event listeners registered once still need the current editor state.
  const codeRef = useRef(code);
  codeRef.current = code;

  // Desktop media keys (MPRIS) arrive outside any user gesture. They can stop
  // playback at any time, but may only *start* it once a real gesture has
  // already unlocked audio - otherwise the request is silently ignored,
  // because resuming a never-activated AudioContext would just fail.
  useEffect(() => {
    let active = true;
    const unlisten = onMediaControl((action) => {
      if (!active) return;
      const engaged =
        playbackStateRef.current === "playing" ||
        playbackStateRef.current === "transitioning";

      if (action === "stop" || action === "pause") {
        if (engaged) stop();
        return;
      }
      if (engaged) {
        if (action === "play-pause") stop();
        return;
      }
      const editorCode = codeRef.current;
      if (!playback.isAudioReady() || !editorCode.trim()) return;
      runInBackground(
        play(editorCode).then(() => undefined),
        "[MPRIS] Could not start playback",
      );
    });

    return () => {
      active = false;
      void unlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, [play, playback.isAudioReady, stop]);

  // A second `purple-music …` invocation focuses this window and forwards its arguments.
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
    suggestNewSession: chat.suggestNewSession,
    clearChat: chat.clearChat,
    abortStream: chat.abortStream,
    playbackState: playback.playbackState,
    error: generatedPlaybackError ?? playback.error,
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
