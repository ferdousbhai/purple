import { describe, expect, it, vi } from "vitest";
import { requireRunningAudioContext } from "./audio-activation";

/** A double for the slice of `AudioContext` that activation actually touches. */
function createContext(state: string) {
  const source = {
    buffer: null,
    connect: vi.fn(() => {}),
    start: vi.fn(() => {}),
  };

  return {
    state,
    resume: vi.fn(async () => {}),
    createBuffer: vi.fn(() => ({ length: 1 })),
    createBufferSource: vi.fn(() => source),
    destination: { channelCount: 2 },
  };
}

describe("requireRunningAudioContext", () => {
  it("does not resume an already running context", async () => {
    const context = createContext("running");

    await requireRunningAudioContext(context);

    expect(context.resume).not.toHaveBeenCalled();
    expect(context.createBufferSource).toHaveBeenCalledOnce();
  });

  it("waits for a suspended context to become running", async () => {
    const context = createContext("suspended");
    context.resume.mockImplementation(async () => {
      context.state = "running";
    });

    await requireRunningAudioContext(context);

    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("rejects WebKit contexts that remain interrupted", async () => {
    const context = createContext("interrupted");

    await expect(
      requireRunningAudioContext(context),
    ).rejects.toThrow("Audio output is blocked (interrupted)");
    expect(context.createBufferSource).not.toHaveBeenCalled();
  });

  it("reports resume failures instead of swallowing them", async () => {
    const context = createContext("suspended");
    context.resume.mockRejectedValue(new Error("permission denied"));

    await expect(
      requireRunningAudioContext(context),
    ).rejects.toThrow("permission denied");
  });
});
