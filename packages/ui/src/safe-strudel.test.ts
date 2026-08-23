import { describe, expect, it, vi } from "vitest";
import { evaluateSafeStrudelExpression } from "./safe-strudel";

interface FakePattern {
  fast(value: number): FakePattern;
  gain(value: number): FakePattern;
  jux(transform: (value: FakePattern) => FakePattern): FakePattern;
}

function scope() {
  const gain = vi.fn<(value: number) => FakePattern>();
  const jux = vi.fn<(transform: (value: FakePattern) => FakePattern) => FakePattern>();
  const pattern: FakePattern = {
    fast: () => pattern,
    gain: (value) => {
      gain(value);
      return pattern;
    },
    jux: (transform) => {
      jux(transform);
      return transform(pattern);
    },
  };
  return {
    gain,
    pattern,
    scope: {
      Math: Object.freeze({ max: Math.max, min: Math.min }),
      m: vi.fn((value: string) => value),
      run: vi.fn(() => pattern),
      s: vi.fn(() => pattern),
      signal: vi.fn((transform: (cycle: number) => number) => transform(12)),
    },
  };
}

describe("evaluateSafeStrudelExpression", () => {
  it("interprets documented calls, mini strings, arithmetic and transforms", () => {
    const fixture = scope();
    const result = evaluateSafeStrudelExpression(
      's("bd*4").gain(3/4).jux(x => x.gain(.5))',
      fixture.scope,
    );

    expect(result).toBe(fixture.pattern);
    expect(fixture.scope.m).toHaveBeenCalledWith("bd*4", 2);
    expect(fixture.gain).toHaveBeenCalledWith(0.75);
    expect(fixture.gain).toHaveBeenCalledWith(0.5);
  });

  it("supports Purple's bounded transition signal", () => {
    const fixture = scope();
    expect(
      evaluateSafeStrudelExpression(
        "signal(cycle => Math.max(0, Math.min(1, (cycle - 8) / 4)))",
        fixture.scope,
      ),
    ).toBe(1);
  });

  it("allows bounded numeric mini-patterns for event transforms", () => {
    const fixture = scope();
    expect(
      evaluateSafeStrudelExpression('run("<1 2>")', fixture.scope),
    ).toBe(fixture.pattern);
  });

  it("allows an explanatory comment on every code line", () => {
    const fixture = scope();
    expect(
      evaluateSafeStrudelExpression(
        `s( // create a sound pattern
  "bd" // use the bass drum
) // finish the sound
  .gain( // set the volume
    .8 // keep it below full gain
  ) // finish the volume control`,
        fixture.scope,
      ),
    ).toBe(fixture.pattern);
    expect(fixture.gain).toHaveBeenCalledWith(0.8);
  });

  it.each([
    "globalThis.fetch('https://example.com')",
    "window.localStorage.clear()",
    "s.constructor('return globalThis')()",
    "s(`bd`).constructor.constructor('return window')()",
    "import('https://example.com/payload.js')",
    "new AudioContext()",
    "(()=>{ while(true){} })()",
    "s('bd'); fetch('https://example.com')",
    "({ get value() { return fetch('https://example.com') } }).value",
  ])("rejects arbitrary JavaScript: %s", (source) => {
    expect(() => evaluateSafeStrudelExpression(source, scope().scope)).toThrow(
      /not allowed|not part|one Strudel expression|Only named|not an allowed/,
    );
  });

  it.each([
    ["10 ** 10000", "finite number"],
    ["run(100000)", "cumulative event multiplier"],
    ["run(32).fast(32)", "cumulative event multiplier"],
    ["run('1000000000')", "cumulative event multiplier"],
    ['run("1000000000")', "Mini-notation numbers may not exceed"],
    ['run(2).fast("sine")', "bounded numeric first argument"],
    ['s("bd*1000000000")', "Mini-notation numbers may not exceed"],
    ['s("bd*32").fast(32)', "cumulative event multiplier"],
  ])("rejects resource-exhausting pattern %s", (source, message) => {
    expect(() => evaluateSafeStrudelExpression(source, scope().scope)).toThrow(
      message,
    );
  });
});
