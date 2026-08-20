/** The context's audio output, which the priming source connects to. */
export interface OutputNode {
  readonly channelCount: number;
}

/** The silent buffer that primes the output. */
export interface PrimingBuffer {
  readonly length: number;
}

/** The one-shot source that plays the priming buffer. */
export interface PrimingSource {
  buffer: PrimingBuffer | null;
  connect(destination: OutputNode): void;
  start(): void;
}

/**
 * The slice of `AudioContext` that activation touches. `state` is a plain
 * string rather than `AudioContextState` on purpose: WebKit reports the
 * non-standard "interrupted" state, which the standard union does not admit.
 */
export interface ActivatableAudioContext {
  readonly state: string;
  resume(): Promise<void>;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): PrimingBuffer;
  createBufferSource(): PrimingSource;
  readonly destination: OutputNode;
}

const RUNNING_STATE = "running";
const primedContexts = new WeakSet<ActivatableAudioContext>();

/**
 * Resume Web Audio while the caller is still handling a user gesture and fail
 * if the browser keeps the context blocked. WebKit exposes the non-standard
 * "interrupted" state when its autoplay policy prevents output.
 */
export async function requireRunningAudioContext(
  context: ActivatableAudioContext,
): Promise<void> {
  const initialState = context.state;
  if (initialState === "closed") {
    throw new Error("Audio output is closed. Reload Purple and try again.");
  }

  if (initialState !== RUNNING_STATE) {
    try {
      await context.resume();
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(
        `Audio output could not be enabled${detail}. Click Play to try again.`,
      );
    }
  }

  const resumedState = context.state;
  if (resumedState !== RUNNING_STATE) {
    throw new Error(
      `Audio output is blocked (${resumedState}). Click Play to enable sound.`,
    );
  }

  primeAudioOutput(context);
}

function primeAudioOutput(context: ActivatableAudioContext): void {
  if (primedContexts.has(context)) return;
  try {
    const buffer = context.createBuffer(1, 1, 22050);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    primedContexts.add(context);
  } catch (error) {
    console.warn("[Audio] Could not prime the running audio context:", error);
  }
}
