import { Electroview } from "electrobun/view";
import type { RiffRPC } from "../shared/rpc-schema";

interface StreamHandler {
  onDelta?: (requestId: string, delta: string) => void;
  onDone?: (requestId: string) => void;
  onError?: (requestId: string, error: string) => void;
}

let streamHandler: StreamHandler = {};

export function setStreamHandler(handler: StreamHandler) {
  streamHandler = handler;
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
    },
  },
});

export const electroview = new Electroview({ rpc });
