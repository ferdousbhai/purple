import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultEnsureRunningContext } from "./use-strudel";

afterEach(() => {
  vi.useRealTimers();
});

describe("defaultEnsureRunningContext", () => {
  it("resumes a suspended context", async () => {
    let state: AudioContextState = "suspended";
    await expect(
      defaultEnsureRunningContext({
        get state() {
          return state;
        },
        resume: async () => {
          state = "running";
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("reports blocked audio when resume never settles without a gesture", async () => {
    vi.useFakeTimers();
    const outcome = defaultEnsureRunningContext({
      state: "suspended",
      resume: () => new Promise(() => {}),
    }).then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(outcome).resolves.toBe(
      "Audio output is blocked (suspended). Click Play to enable sound.",
    );
  });

  it("rejects a closed context without resuming it", async () => {
    const resume = vi.fn(async () => {});
    await expect(
      defaultEnsureRunningContext({ state: "closed", resume }),
    ).rejects.toThrow("Audio output is closed");
    expect(resume).not.toHaveBeenCalled();
  });
});
