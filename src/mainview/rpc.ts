import { Electroview } from "electrobun/view";
import type { RiffRPC } from "../shared/rpc-schema";
import type { TransitionSuggestion } from "../shared/types";

interface StreamHandler {
  onDelta?: (requestId: string, delta: string) => void;
  onDone?: (requestId: string) => void;
  onError?: (requestId: string, error: string) => void;
}

interface TitleHandler {
  onDone?: (requestId: string, title: string) => void;
  onError?: (requestId: string, error: string) => void;
}

interface TransitionSuggestionsHandler {
  onDone?: (requestId: string, suggestions: TransitionSuggestion[]) => void;
  onError?: (requestId: string, error: string) => void;
}

let streamHandler: StreamHandler = {};
let titleHandler: TitleHandler = {};
let transitionSuggestionsHandler: TransitionSuggestionsHandler = {};

export function setStreamHandler(handler: StreamHandler) {
  streamHandler = handler;
}

export function setTitleHandler(handler: TitleHandler) {
  titleHandler = handler;
}

export function setTransitionSuggestionsHandler(
  handler: TransitionSuggestionsHandler,
) {
  transitionSuggestionsHandler = handler;
}

const rpc = Electroview.defineRPC<RiffRPC>({
  handlers: {
    requests: {},
    messages: {
      streamDelta: ({ requestId, delta }) =>
        streamHandler.onDelta?.(requestId, delta),
      streamDone: ({ requestId }) => streamHandler.onDone?.(requestId),
      streamError: ({ requestId, error }) =>
        streamHandler.onError?.(requestId, error),
      titleDone: ({ requestId, title }) =>
        titleHandler.onDone?.(requestId, title),
      titleError: ({ requestId, error }) =>
        titleHandler.onError?.(requestId, error),
      transitionSuggestionsDone: ({ requestId, suggestions }) =>
        transitionSuggestionsHandler.onDone?.(requestId, suggestions),
      transitionSuggestionsError: ({ requestId, error }) =>
        transitionSuggestionsHandler.onError?.(requestId, error),
    },
  },
});

export const electroview = new Electroview({ rpc });
