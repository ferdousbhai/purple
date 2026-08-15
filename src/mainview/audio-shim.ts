/**
 * WebKitGTK WebAudio Shim for Linux/Omarchy:
 * In WebKitGTK:
 * ChannelMergerNode / ChannelSplitterNode with 0 channels throws DOMException
 * on affected WebKitGTK builds. Normalize only that invalid constructor input;
 * do not mask the device's real channel capabilities or setter failures.
 */

export function applyWebAudioShim(): void {
  if (typeof window === "undefined" || !window.AudioContext) return;
  if (!isLinuxWebKitUserAgent(navigator.userAgent) || window.__riffAudioShimApplied)
    return;
  window.__riffAudioShimApplied = true;

  // Wrap ChannelMergerNode constructor & createChannelMerger
  const OriginalChannelMergerNode = window.ChannelMergerNode;
  if (OriginalChannelMergerNode) {
    window.ChannelMergerNode = class extends OriginalChannelMergerNode {
      constructor(context: BaseAudioContext, options?: ChannelMergerOptions) {
        const count = normalizeWebAudioChannelCount(options?.numberOfInputs);
        super(context, { ...options, numberOfInputs: count });
      }
    } as typeof ChannelMergerNode;
  }

  // Wrap ChannelSplitterNode constructor & createChannelSplitter
  const OriginalChannelSplitterNode = window.ChannelSplitterNode;
  if (OriginalChannelSplitterNode) {
    window.ChannelSplitterNode = class extends OriginalChannelSplitterNode {
      constructor(context: BaseAudioContext, options?: ChannelSplitterOptions) {
        const count = normalizeWebAudioChannelCount(options?.numberOfOutputs);
        super(context, { ...options, numberOfOutputs: count });
      }
    } as typeof ChannelSplitterNode;
  }

  // Wrap BaseAudioContext factory methods
  const proto = BaseAudioContext.prototype as unknown as {
    createChannelMerger?: (numberOfInputs?: number) => ChannelMergerNode;
    createChannelSplitter?: (numberOfOutputs?: number) => ChannelSplitterNode;
  };
  if (proto) {
    if (proto.createChannelMerger) {
      const origCreateMerger = proto.createChannelMerger;
      proto.createChannelMerger = function (numberOfInputs?: number) {
        const count = normalizeWebAudioChannelCount(numberOfInputs);
        return origCreateMerger.call(this, count);
      };
    }
    if (proto.createChannelSplitter) {
      const origCreateSplitter = proto.createChannelSplitter;
      proto.createChannelSplitter = function (numberOfOutputs?: number) {
        const count = normalizeWebAudioChannelCount(numberOfOutputs);
        return origCreateSplitter.call(this, count);
      };
    }
  }

  patchZeroChannelDestination();

}

function patchZeroChannelDestination(): void {
  const destinationPrototype = window.AudioDestinationNode?.prototype;
  const audioNodePrototype = window.AudioNode?.prototype;
  if (!destinationPrototype || !audioNodePrototype) return;

  const maxChannelDescriptor = Object.getOwnPropertyDescriptor(
    destinationPrototype,
    "maxChannelCount",
  );
  const channelDescriptor = Object.getOwnPropertyDescriptor(
    audioNodePrototype,
    "channelCount",
  );
  if (
    !maxChannelDescriptor?.get ||
    !channelDescriptor?.get ||
    !channelDescriptor.set
  ) {
    return;
  }

  const getNativeMaxChannelCount = maxChannelDescriptor.get;
  const getNativeChannelCount = channelDescriptor.get;
  const setNativeChannelCount = channelDescriptor.set;
  let reportedCompatibilityMode = false;

  Object.defineProperty(destinationPrototype, "maxChannelCount", {
    ...maxChannelDescriptor,
    get() {
      const reported = getNativeMaxChannelCount.call(this) as number;
      return normalizeDestinationChannelCount(reported);
    },
  });

  Object.defineProperty(destinationPrototype, "channelCount", {
    ...channelDescriptor,
    get() {
      const reported = getNativeChannelCount.call(this) as number;
      return normalizeDestinationChannelCount(reported);
    },
    set(value: number) {
      try {
        setNativeChannelCount.call(this, value);
      } catch (error) {
        const nativeMaximum = getNativeMaxChannelCount.call(this) as number;
        if (!isKnownWebKitStereoAssignment(nativeMaximum, value)) throw error;
        if (!reportedCompatibilityMode) {
          reportedCompatibilityMode = true;
          console.warn(
            "[Audio] WebKitGTK reported zero output channels; using its working stereo destination.",
          );
        }
      }
    },
  });
}

export function normalizeWebAudioChannelCount(
  value: number | undefined,
): number | undefined {
  return value === 0 ? 2 : value;
}

export function normalizeDestinationChannelCount(value: number): number {
  return value === 0 ? 2 : value;
}

export function isKnownWebKitStereoAssignment(
  nativeMaximum: number,
  requestedChannels: number,
): boolean {
  return nativeMaximum === 0 && requestedChannels === 2;
}

export function isLinuxWebKitUserAgent(userAgent: string): boolean {
  return (
    /Linux/i.test(userAgent) &&
    /AppleWebKit/i.test(userAgent) &&
    !/(Chrome|Chromium|Edg)/i.test(userAgent)
  );
}

declare global {
  interface Window {
    __riffAudioShimApplied?: boolean;
  }
}
