import { useCallback, useEffect, useState } from "react";
import type { ApiKeyStatus } from "../../shared/types";
import { electroview } from "../rpc";
import { buildRetryMessage, useChat } from "./useChat";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { usePlayback } from "./usePlayback";

const MAX_RETRIES = 2;

export function useRiffController() {
  const [code, setCode] = useState("");
  const [requiresUserActivation, setRequiresUserActivation] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({
    hasKey: false,
    source: "missing",
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const chat = useChat();
  const playback = usePlayback();

  useKeyboardShortcuts({
    onStop: playback.stop,
    onAbort: chat.abortStream,
    isStreaming: chat.isStreaming,
  });

  const saveApiKey = useCallback(async (apiKey: string) => {
    const status = await electroview.rpc!.request.saveApiKey({ apiKey });
    setApiKeyStatus(status);
  }, []);

  const clearApiKey = useCallback(async () => {
    const status = await electroview.rpc!.request.clearApiKey({});
    setApiKeyStatus(status);
  }, []);

  const runPrompt = useCallback(
    async (text: string, shouldPlay = true): Promise<void> => {
      const pattern = await chat.sendMessage(text);
      if (!pattern) return;

      setCode(pattern);
      if (!shouldPlay) {
        setRequiresUserActivation(true);
        return;
      }

      setRequiresUserActivation(false);
      const result = await playback.play(pattern);
      if (result.ok || result.kind !== "evaluation") return;

      let lastError = result.error;
      let lastCode = pattern;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const fixedPattern = await chat.sendMessage(
          buildRetryMessage(lastCode, lastError),
          { hiddenUserMessage: true },
        );
        if (!fixedPattern) break;

        setCode(fixedPattern);
        const retryResult = await playback.play(fixedPattern);
        if (retryResult.ok || retryResult.kind !== "evaluation") break;

        lastError = retryResult.error;
        lastCode = fixedPattern;
      }
    },
    [chat.sendMessage, playback.play],
  );

  const sendMessage = useCallback(
    (text: string): boolean => {
      if (!apiKeyStatus.hasKey) {
        setIsSettingsOpen(true);
        return false;
      }
      if (playback.playbackState === "loading") return false;

      // Dispatch the model request first, then use the same input event to unlock audio.
      const prompt = runPrompt(text);
      void playback.prepareAudio();
      void prompt.catch((promptError: unknown) => {
        console.error("[Chat] Prompt failed:", promptError);
      });
      return true;
    },
    [
      apiKeyStatus.hasKey,
      playback.playbackState,
      playback.prepareAudio,
      runPrompt,
    ],
  );

  const play = useCallback(
    async (editorCode: string) => {
      setRequiresUserActivation(false);
      return playback.play(editorCode);
    },
    [playback.play],
  );

  useEffect(() => {
    let active = true;

    async function loadStartupState(): Promise<void> {
      try {
        const [status, options] = await Promise.all([
          electroview.rpc!.request.getApiKeyStatus({}),
          electroview.rpc!.request.getStartupOptions({}),
        ]);
        if (!active) return;

        setApiKeyStatus(status);
        if (options.initialCode) {
          setCode(options.initialCode);
          setRequiresUserActivation(Boolean(options.requestPlayback));
        } else if (options.initialPrompt) {
          if (!status.hasKey) {
            setIsSettingsOpen(true);
            return;
          }
          void runPrompt(options.initialPrompt, false).catch(
            (promptError: unknown) => {
              console.error("[Startup] Initial prompt failed:", promptError);
            },
          );
        }
      } catch (startupError) {
        console.error("[Startup] Could not load startup state:", startupError);
      }
    }

    void loadStartupState();
    return () => {
      active = false;
    };
  }, [runPrompt]);

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
    stop: playback.stop,
    code,
    setCode,
    requiresUserActivation,
    apiKeyStatus,
    isSettingsOpen,
    setIsSettingsOpen,
    saveApiKey,
    clearApiKey,
    sendMessage,
    play,
  };
}
