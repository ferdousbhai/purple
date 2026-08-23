import { describe, expect, it, vi } from "vitest";
// @strudel/mini does not publish declarations for its parser subpath.
// @ts-expect-error Test the safety estimator against Strudel's real parser.
import { parse as parseMiniNotation } from "@strudel/mini/krill-parser.js";
import {
  createSafeStrudelScope,
  evaluateSafeStrudelExpression,
} from "./safe-strudel";

interface FakePattern {
  fast(value: number): FakePattern;
  gain(value: number): FakePattern;
  jux(transform: (value: FakePattern) => FakePattern): FakePattern;
  layer(...transforms: Array<(value: FakePattern) => FakePattern>): FakePattern;
  struct(value: string): FakePattern;
}

interface NumericCycle {
  valueOf(): number;
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
    layer: (...transforms) => {
      transforms.forEach((transform) => transform(pattern));
      return pattern;
    },
    struct: () => pattern,
  };
  return {
    gain,
    pattern,
    scope: createSafeStrudelScope({
      Math: Object.freeze({ max: Math.max, min: Math.min }),
      cat: vi.fn(() => pattern),
      m: vi.fn((value: string) => value),
      mini2ast: parseMiniNotation,
      run: vi.fn(() => pattern),
      s: vi.fn(() => pattern),
      // The engine passes the query span's begin as a Fraction, not a plain
      // number; the fixture mirrors that with a numeric-like object.
      signal: vi.fn((transform: (cycle: NumericCycle) => number) =>
        transform({ valueOf: () => 12 }),
      ),
      stack: vi.fn(() => pattern),
      xfade: vi.fn(() => pattern),
    }),
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

  it("checks xfade repetition budgets per parallel branch", () => {
    const fixture = scope();
    const transition = `xfade(
      s("bd*32"),
      signal(cycle => Math.max(0, Math.min(1, (cycle - 8) / 4))),
      s("hh*32")
    )`;

    expect(
      evaluateSafeStrudelExpression(transition, fixture.scope),
    ).toBe(fixture.pattern);
    expect(
      evaluateSafeStrudelExpression(
        transition.replaceAll("*32", "*300"),
        fixture.scope,
      ),
    ).toBe(fixture.pattern);
    expect(() =>
      evaluateSafeStrudelExpression(
        `${transition}.fast(32)`,
        fixture.scope,
      ),
    ).toThrow("cumulative event multiplier");
  });

  it("adds independent stack branches instead of multiplying them", () => {
    const fixture = scope();
    expect(
      evaluateSafeStrudelExpression(
        'stack(s("bd*32"), s("hh*32"))',
        fixture.scope,
      ),
    ).toBe(fixture.pattern);
    expect(() =>
      evaluateSafeStrudelExpression(
        'stack(s("bd*32"), s("hh*32")).fast(9)',
        fixture.scope,
      ),
    ).toThrow("cumulative event multiplier");
    expect(
      evaluateSafeStrudelExpression(
        'cat(s("bd*300"), s("hh*300"))',
        fixture.scope,
      ),
    ).toBe(fixture.pattern);
  });

  it("carries patterned method arguments and layered callbacks forward", () => {
    const fixture = scope();
    expect(() =>
      evaluateSafeStrudelExpression(
        's("bd").struct("x*300").fast(2)',
        fixture.scope,
      ),
    ).toThrow("cumulative event multiplier");
    expect(() =>
      evaluateSafeStrudelExpression(
        's("bd").layer(x => x.fast(300), x => x.fast(300))',
        fixture.scope,
      ),
    ).toThrow("cumulative event multiplier");
  });

  it("accounts for nested and parallel mini-notation structure", () => {
    const fixture = scope();
    expect(
      evaluateSafeStrudelExpression('s("bd*32, hh*32")', fixture.scope),
    ).toBe(fixture.pattern);
    expect(() =>
      evaluateSafeStrudelExpression('s("bd*300, hh*300")', fixture.scope),
    ).toThrow("cumulative event multiplier");
    expect(() =>
      evaluateSafeStrudelExpression('s("[bd hh]*300")', fixture.scope),
    ).toThrow("cumulative event multiplier");
    expect(
      evaluateSafeStrudelExpression(
        's("<bd*300 hh*300>")',
        fixture.scope,
      ),
    ).toBe(fixture.pattern);
    expect(
      evaluateSafeStrudelExpression(
        's("[bd*300 hh*300]/2")',
        fixture.scope,
      ),
    ).toBe(fixture.pattern);
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
    ['s("bd(4096,4096)")', "cumulative event multiplier"],
    ['s("bd(3,1024)")', "cumulative event multiplier"],
    ['s("bd(3,[1 .. 4096])")', "cumulative event multiplier"],
    ['s("bd([1*4096],8)")', "cumulative event multiplier"],
    ['s("0 .. 4096")', "cumulative event multiplier"],
  ])("rejects resource-exhausting pattern %s", (source, message) => {
    expect(() => evaluateSafeStrudelExpression(source, scope().scope)).toThrow(
      message,
    );
  });
});
