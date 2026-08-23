import { describe, expect, it } from "vitest";
import { transitionWaitTimeoutMs } from "./use-playback";

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
