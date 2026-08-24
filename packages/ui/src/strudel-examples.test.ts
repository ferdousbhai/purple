/**
 * Every example shipped in the system prompt must evaluate against the real
 * Strudel engine through Purple's safe expression interpreter, both standalone
 * and spliced into an XFADE transition.
 * A broken example would few-shot-teach Gemini invalid patterns, and a
 * non-expression example would break crossfades.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PROMPT_EXAMPLES } from "@purple/core/prompts";
import { buildTransitionCode } from "@purple/core/transitions";
import { auditHapSounds, type AuditableHap } from "@purple/core/validation";
// @strudel/core does not publish declarations for this runtime test surface.
// @ts-expect-error The integration assertions below verify the actual exports.
import { evalScope, strudelScope } from "@strudel/core";
import {
  createSafeStrudelScope,
  evaluateSafeStrudelExpression,
  isQueryablePattern,
  type SafeStrudelScope,
} from "./safe-strudel";

interface EvaluatedHap extends AuditableHap {
  context?: { locations?: Array<{ start: number; end: number }> };
  value?: {
    readonly bank?: number | string | null;
    readonly gain?: number;
    readonly s?: number | string | null;
  };
}

interface EvaluatedPattern {
  queryArc: (begin: number, end: number) => EvaluatedHap[];
}

let safeScope: SafeStrudelScope;

beforeAll(async () => {
  await evalScope(
    // @ts-expect-error @strudel/core does not publish declarations.
    import("@strudel/core"),
    // @ts-expect-error @strudel/mini does not publish declarations.
    import("@strudel/mini"),
    // @ts-expect-error @strudel/tonal does not publish declarations.
    import("@strudel/tonal"),
  );
  safeScope = createSafeStrudelScope({
    ...strudelScope,
  });
});

async function evaluatePattern(code: string): Promise<EvaluatedPattern> {
  const pattern = evaluateSafeStrudelExpression(code, safeScope);
  if (!isQueryablePattern<EvaluatedPattern>(pattern)) {
    throw new Error("safe expression did not produce a Strudel pattern");
  }
  return pattern;
}

async function expectPatternEvents(code: string): Promise<void> {
  const pattern = await evaluatePattern(code);
  expect(pattern.queryArc(0, 4).length).toBeGreaterThan(0);
}

const numberedExamples = PROMPT_EXAMPLES.map(
  (code, index): [number, string] => [index, code],
);

describe("PROMPT_EXAMPLES", () => {
  it.each(numberedExamples)(
    "example %i evaluates to a pattern with events",
    async (_index: number, code: string) => {
      await expectPatternEvents(code);
    },
  );

  it("examples stay composable inside an XFADE transition", async () => {
    const [from, to] = PROMPT_EXAMPLES;
    if (!from || !to) throw new Error("need at least two prompt examples");
    const pattern = await evaluatePattern(buildTransitionCode(from, to, 8, 4));
    expect(pattern.queryArc(0, 4).length).toBeGreaterThan(0);
  });

  it("keeps events flowing with finite gains through the crossfade window", async () => {
    // Regression: signal() hands its callback a Fraction, not a number. The
    // interpreted arrow used to throw on every query, which Strudel swallows
    // into zero haps - total silence for the whole fade.
    const pattern = await evaluatePattern(
      buildTransitionCode('s("bd*4")', 's("hh*4")', 8, 4),
    );
    const haps = pattern.queryArc(9, 10);
    expect(haps.length).toBeGreaterThan(0);
    for (const hap of haps) {
      const gain = hap.value?.gain ?? Number.NaN;
      expect(Number.isFinite(gain)).toBe(true);
      expect(gain).toBeGreaterThan(0);
    }
  });

  it("xfades repeated patterns without multiplying parallel safety budgets", async () => {
    await expect(
      evaluatePattern(
        buildTransitionCode('s("bd*32")', 's("hh*32")', 8, 4),
      ),
    ).resolves.toBeDefined();
  });

  it("preserves mini-notation source locations for playback highlighting", async () => {
    const pattern = await evaluatePattern('s("bd hh")');
    const locations = pattern
      .queryArc(0, 1)
      .flatMap((hap) => hap.context?.locations ?? []);
    expect(locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
      ]),
    );
  });
});

describe("expanded vocabulary", () => {
  // Every name allowlisted in SAFE_GLOBALS/SAFE_MEMBERS beyond the original
  // prompt surface must prove itself against the real engine: a bogus name
  // would throw "not callable" here instead of silently failing at playback.
  it.each([
    ["supersaw shaping", 'note("c2 eb2 g2").s("supersaw").detune(.3).unison(5).spread(.8)'],
    ["pulse width", 'note("c3*4").s("pulse").pw(.2).pwrate(2).pwsweep(.3)'],
    ["fm envelope and carrier wave", 'note("c3").fm(4).fmenv(2).fmwave("sine")'],
    ["high/band-pass resonance and DJ filter", 's("hh*8").hpf(1000).hpq(15).ftype("ladder").djf(.7)'],
    ["band-pass resonance", 's("hh*8").bpf(800).bpq(5)'],
    ["reverb shaping and gain staging", 's("bd*2").room(.5).roomdim(.4).roomfade(.7).roomlp(8000).dry(.6).drive(.3).postgain(.8)'],
    ["sidechain onset", 's("bd*4").duckorbit(1).duckattack(.1).duckdepth(.8).duckonset(.02)'],
    ["phaser shaping", 's("hh*8").phaser(2).phaserdepth(.8).phasercenter(1000).phasersweep(500)'],
    ["tremolo family", 'note("c3").tremolosync(4).tremolodepth(.9).tremoloskew(.5).tremolophase(.2).tremoloshape("sine")'],
    ["chunked transform", 's("bd sd hh sd").chunk(4, x => x.speed(2))'],
    ["backwards chunk", 's("bd sd hh sd").chunkBack(4, x => x.gain(.5))'],
    ["slice randomizers", 's("breaks165").scramble(8)'],
    ["shuffled slices", 's("breaks165").shuffle(8)'],
    ["interleaved granular striate", 's("breaks165").striate(8)'],
    ["stuttered echoes", 'note("c3 e3").stut(3, .5, .125)'],
    ["echo with per-repeat transform", 's("bd sd").echoWith(3, .125, (x, i) => x.gain(1 - i * .2))'],
    ["probability family", 's("hh*8").almostAlways(x => x.speed(2)).almostNever(rev)'],
    ["deterministic conditionals", 's("hh*8").always(x => x.pan(0)).never(x => x.pan(1))'],
    ["per-cycle probability", 's("bd*4").someCyclesBy(.3, x => x.rev())'],
    ["degrade complements", 's("hh*16").degrade().undegradeBy(.3)'],
    ["exponential signal range", 's("hh*8").lpf(saw.rangex(200, 4000).slow(4))'],
    ["quantized signal melodies", 'n(sine.range(0, 7).floor().segment(8)).scale("C:minor")'],
    ["rounded signal", 'n(sine.range(0, 4).round().segment(4)).scale("C:major")'],
    ["ceiling signal", 'n(sine.range(0, 4).ceil().segment(4)).scale("C:major")'],
    ["weighted random choice", 's(wchoose(["bd", 3], ["hh", 1]).segment(4))'],
    ["binary random mask", 'note("c3*8").mask(brand.segment(8))'],
    ["biased binary random mask", 'note("c3*8").mask(brandBy(.8).segment(8))'],
    ["chord arpeggios", 'chord("<Cm7 F7>").voicing().arp("0 2 1 3")'],
    ["beat grid rhythms", 's("bd").beat("0,7,10", 16)'],
    ["cycle-slice transform", 's("bd*4 hh*4").within(0, .5, x => x.rev())'],
    ["hurried breaks", 's("breaks165").chop(8).hurry(2)'],
    ["backwards iteration", 's("hh*8").iterBack(4)'],
    ["inverted binary mask", 'note("c e g").mask("1 0 1".invert())'],
    ["repeated random cycles", 'note(choose("c3", "e3", "g3").segment(4)).repeatCycles(2)'],
    ["mini-notation feet grouping", 's("bd . hh hh . sd")'],
    ["mini-notation ranges", 'n("0 .. 7").scale("C:minor")'],
    ["signal-driven DJ-filter riser", 's("hh*8").djf(saw.slow(8).range(.5, .9))'],
  ])("%s evaluates to a pattern with events", async (_label, code) => {
    await expectPatternEvents(code);
  });

  it.each([
    's("bd").striate(600)',
    's("bd*2").stut(300, .5, .1)',
    's("bd*32").echo(32, .125, .5)',
    's("breaks165").chop(8).hurry(100)',
  ])("keeps %s inside the event budget", (code) => {
    expect(() => evaluateSafeStrudelExpression(code, safeScope)).toThrow(
      "cumulative event multiplier",
    );
  });
});

describe("auditHapSounds on real evaluated patterns", () => {
  it("sees through stack/cpm/bank to every sound the engine would look up", async () => {
    const [houseExample] = PROMPT_EXAMPLES;
    if (!houseExample) throw new Error("need the house prompt example");
    const pattern = await evaluatePattern(houseExample);
    // An empty registry makes the audit list everything the pattern asks the
    // engine for - proving extraction works on real haps, banks included.
    const requested = auditHapSounds(pattern.queryArc(0, 4), () => false);
    expect(requested).toEqual(
      expect.arrayContaining([
        "RolandTR909_bd",
        "RolandTR909_cp",
        "RolandTR909_hh",
        "sawtooth",
      ]),
    );
    // And a registry holding exactly those names passes the audit.
    const registry = new Set(requested.map((name) => name.toLowerCase()));
    const unknown = auditHapSounds(pattern.queryArc(0, 4), (name) =>
      registry.has(name.toLowerCase()),
    );
    expect(unknown).toEqual([]);
  });
});
