const RUNNING_STATE = "running";
const primedContexts = new WeakSet<AudioContext>();

/**
 * Resume Web Audio while the caller is still handling a user gesture and fail
 * if the browser keeps the context blocked. WebKit exposes the non-standard
 * "interrupted" state when its autoplay policy prevents output.
 */
export async function requireRunningAudioContext(
  context: AudioContext,
): Promise<void> {
  const initialState = String(context.state);
  if (initialState === "closed") {
    throw new Error("Audio output is closed. Reload Riff and try again.");
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

  const resumedState = String(context.state);
  if (resumedState !== RUNNING_STATE) {
    throw new Error(
      `Audio output is blocked (${resumedState}). Click Play to enable sound.`,
    );
  }

  primeAudioOutput(context);
}

function primeAudioOutput(context: AudioContext): void {
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
