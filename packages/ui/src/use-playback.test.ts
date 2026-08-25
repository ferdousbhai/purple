import { describe, expect, it } from "vitest";
import {
  progressionWaitPollMs,
  progressionWaitTimeoutMs,
  transitionWaitTimeoutMs,
} from "./use-playback";

describe("transitionWaitTimeoutMs", () => {
  it("allows slow transitions enough time to follow the scheduler", () => {
    expect(transitionWaitTimeoutMs(16, 0.25)).toBe(138_000);
  });

  it("bounds stalled or extreme scheduler timing", () => {
    expect(transitionWaitTimeoutMs(16, 0)).toBe(60_000);
    expect(transitionWaitTimeoutMs(16, 0.001)).toBe(600_000);
  });

  it("keeps fast transitions cancellable for at least thirty seconds", () => {
    expect(transitionWaitTimeoutMs(2, 2)).toBe(30_000);
  });
});

describe("progression scheduler wait", () => {
  it("sleeps near a distant musical wake and polls closely near the target", () => {
    expect(progressionWaitPollMs(16, 0.5)).toBe(30_000);
    expect(progressionWaitPollMs(0.25, 0.5)).toBe(500);
    expect(progressionWaitPollMs(0.001, 0.5)).toBe(100);
  });

  it("allows longer pattern plans without waiting forever on a stall", () => {
    expect(progressionWaitTimeoutMs(64, 0.1)).toBe(1_290_000);
    expect(progressionWaitTimeoutMs(64, 0.01)).toBe(12_810_000);
  });
});
