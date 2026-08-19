/**
 * Linux WebKitGTK Web Audio shim. Affected builds throw a DOMException when a
 * ChannelMergerNode / ChannelSplitterNode is constructed with 0 channels.
 * Normalize only that invalid constructor input; do not mask the device's real
 * channel capabilities or setter failures.
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
    };
  }

  // Wrap ChannelSplitterNode constructor & createChannelSplitter
  const OriginalChannelSplitterNode = window.ChannelSplitterNode;
  if (OriginalChannelSplitterNode) {
    window.ChannelSplitterNode = class extends OriginalChannelSplitterNode {
      constructor(context: BaseAudioContext, options?: ChannelSplitterOptions) {
        const count = normalizeWebAudioChannelCount(options?.numberOfOutputs);
        super(context, { ...options, numberOfOutputs: count });
      }
    };
  }

  // Wrap BaseAudioContext factory methods. Typed with optional members because
  // older WebKitGTK builds may not expose them at all.
  const proto: ChannelNodeFactories = BaseAudioContext.prototype;
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

  patchZeroChannelDestination();
}

interface ChannelNodeFactories {
  createChannelMerger?: (numberOfInputs?: number) => ChannelMergerNode;
  createChannelSplitter?: (numberOfOutputs?: number) => ChannelSplitterNode;
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

  // PropertyDescriptor types accessors as `any`; name their real signatures
  // once here so the wrappers below need no casts.
  const getNativeMaxChannelCount: () => number = maxChannelDescriptor.get;
  const getNativeChannelCount: () => number = channelDescriptor.get;
  const setNativeChannelCount: (value: number) => void = channelDescriptor.set;
  let reportedCompatibilityMode = false;

  Object.defineProperty(destinationPrototype, "maxChannelCount", {
    ...maxChannelDescriptor,
    get() {
      return normalizeDestinationChannelCount(
        getNativeMaxChannelCount.call(this),
      );
    },
  });

  Object.defineProperty(destinationPrototype, "channelCount", {
    ...channelDescriptor,
    get() {
      return normalizeDestinationChannelCount(getNativeChannelCount.call(this));
    },
    set(value: number) {
      try {
        setNativeChannelCount.call(this, value);
      } catch (error) {
        const nativeMaximum = getNativeMaxChannelCount.call(this);
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
