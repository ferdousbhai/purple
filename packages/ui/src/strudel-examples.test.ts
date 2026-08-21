/**
 * Every example shipped in the system prompt must evaluate against the real
 * Strudel engine (transpiler + core + mini + tonal — the same packages
 * @strudel/web wraps), both standalone and spliced into an XFADE transition.
 * A broken example would few-shot-teach Gemini invalid patterns, and a
 * non-expression example would break crossfades.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PROMPT_EXAMPLES } from "@purple/core/prompts";
import { buildTransitionCode } from "@purple/core/transitions";
import { auditHapSounds, type AuditableHap } from "@purple/core/validation";
import { evalScope } from "@strudel/core";
import { evaluate } from "@strudel/transpiler";

interface EvaluatedPattern {
  queryArc: (begin: number, end: number) => AuditableHap[];
}

beforeAll(async () => {
  await evalScope(
    import("@strudel/core"),
    import("@strudel/mini"),
    import("@strudel/tonal"),
    // xfade lives in the webaudio layer, which needs a browser AudioContext.
    // The stub keeps transition code evaluable; only syntax is under test.
    { xfade: (from: EvaluatedPattern) => from },
  );
});

async function evaluatePattern(code: string): Promise<EvaluatedPattern> {
  const result = await evaluate(code);
  // SAFETY: the Strudel transpiler resolves to { pattern }; if the evaluated
  // value is not a pattern, the queryArc calls in the tests below throw and
  // fail the test, which is exactly the signal this suite exists to produce.
  const { pattern } = result as { pattern: EvaluatedPattern };
  return pattern;
}

const numberedExamples = PROMPT_EXAMPLES.map(
  (code, index): [number, string] => [index, code],
);

describe("PROMPT_EXAMPLES", () => {
  it.each(numberedExamples)(
    "example %i evaluates to a pattern with events",
    async (_index: number, code: string) => {
      const pattern = await evaluatePattern(code);
      expect(pattern.queryArc(0, 4).length).toBeGreaterThan(0);
    },
  );

  it("examples stay composable inside an XFADE transition", async () => {
    const [from, to] = PROMPT_EXAMPLES;
    if (!from || !to) throw new Error("need at least two prompt examples");
    const pattern = await evaluatePattern(buildTransitionCode(from, to, 8, 4));
    expect(pattern.queryArc(0, 4).length).toBeGreaterThan(0);
  });
});

describe("auditHapSounds on real evaluated patterns", () => {
  it("sees through stack/cpm/bank to every sound the engine would look up", async () => {
    const [houseExample] = PROMPT_EXAMPLES;
    if (!houseExample) throw new Error("need the house prompt example");
    const pattern = await evaluatePattern(houseExample);
    // An empty registry makes the audit list everything the pattern asks the
    // engine for — proving extraction works on real haps, banks included.
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
