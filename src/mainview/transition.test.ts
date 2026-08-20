import { describe, expect, it } from "vitest";
import {
  buildTransitionCode,
  getTransitionStartCycle,
} from "@purple/core/transitions";

describe("getTransitionStartCycle", () => {
  it("chooses the next whole cycle with enough evaluation lead time", () => {
    expect(getTransitionStartCycle(12)).toBe(13);
    expect(getTransitionStartCycle(12.6)).toBe(13);
    expect(getTransitionStartCycle(12.9)).toBe(14);
  });
});

describe("buildTransitionCode", () => {
  it("builds a clamped one-way crossfade between two expressions", () => {
    const code = buildTransitionCode('s("bd")', 's("hh")', 13, 8);

    expect(code).toContain("xfade(");
    expect(code).toContain('s("bd")');
    expect(code).toContain('s("hh")');
    expect(code).toContain(
      "Math.max(0, Math.min(1, (cycle - 13) / 8))",
    );
  });

  it("puts closing wrappers on new lines so trailing comments stay contained", () => {
    const code = buildTransitionCode(
      's("bd") // current',
      's("hh") // next',
      4,
      4,
    );

    expect(code).toContain('    s("bd") // current\n  )');
    expect(code).toContain('    s("hh") // next\n  )');
  });

  it("rejects empty patterns and invalid durations", () => {
    expect(() => buildTransitionCode("", 's("hh")', 1, 8)).toThrow(
      "Both transition patterns are required.",
    );
    expect(() => buildTransitionCode('s("bd")', 's("hh")', 1, 0)).toThrow(
      "Transition duration must be greater than zero.",
    );
  });
});
