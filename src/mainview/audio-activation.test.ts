import { describe, expect, it, vi } from "vitest";
import { requireRunningAudioContext } from "./audio-activation";

interface FakeAudioContext {
  state: string;
  resume: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  destination: object;
}

function createContext(state: string): FakeAudioContext {
  const source = {
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
  };

  return {
    state,
    resume: vi.fn().mockResolvedValue(undefined),
    createBuffer: vi.fn().mockReturnValue({}),
    createBufferSource: vi.fn().mockReturnValue(source),
    destination: {},
  };
}

function asAudioContext(context: FakeAudioContext): AudioContext {
  // SAFETY: requireRunningAudioContext only touches state, resume, createBuffer,
  // createBufferSource and destination — every member FakeAudioContext defines.
  return context as unknown as AudioContext;
}

describe("requireRunningAudioContext", () => {
  it("does not resume an already running context", async () => {
    const context = createContext("running");

    await requireRunningAudioContext(asAudioContext(context));

    expect(context.resume).not.toHaveBeenCalled();
    expect(context.createBufferSource).toHaveBeenCalledOnce();
  });

  it("waits for a suspended context to become running", async () => {
    const context = createContext("suspended");
    context.resume.mockImplementation(async () => {
      context.state = "running";
    });

    await requireRunningAudioContext(asAudioContext(context));

    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("rejects WebKit contexts that remain interrupted", async () => {
    const context = createContext("interrupted");

    await expect(
      requireRunningAudioContext(asAudioContext(context)),
    ).rejects.toThrow("Audio output is blocked (interrupted)");
    expect(context.createBufferSource).not.toHaveBeenCalled();
  });

  it("reports resume failures instead of swallowing them", async () => {
    const context = createContext("suspended");
    context.resume.mockRejectedValue(new Error("permission denied"));

    await expect(
      requireRunningAudioContext(asAudioContext(context)),
    ).rejects.toThrow("permission denied");
  });
});
