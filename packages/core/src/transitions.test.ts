import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOPLAY_TRANSITION_CYCLES,
  DEFAULT_MANUAL_TRANSITION_CYCLES,
  TRANSITION_CYCLE_OPTIONS,
} from "./transitions";

describe("transition timing choices", () => {
  it("keeps manual transitions responsive and gives autoplay more room", () => {
    expect(DEFAULT_MANUAL_TRANSITION_CYCLES).toBe(8);
    expect(DEFAULT_AUTOPLAY_TRANSITION_CYCLES).toBe(16);
  });

  it("offers a slower 32-cycle crossfade without extending to 64", () => {
    expect(TRANSITION_CYCLE_OPTIONS).toEqual([4, 8, 16, 32]);
  });
});
