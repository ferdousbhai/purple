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
import { evalScope, strudelScope } from "@strudel/core";
import { PRESET_PATTERNS } from "../../../src/shared/cli";
import {
  createSafeStrudelScope,
  evaluateSafeStrudelExpression,
  type SafeStrudelScope,
  type SafeStrudelValue,
} from "./safe-strudel";

interface EvaluatedPattern {
  queryArc: (begin: number, end: number) => AuditableHap[];
}

let safeScope: SafeStrudelScope;

beforeAll(async () => {
  await evalScope(
    import("@strudel/core"),
    import("@strudel/mini"),
    import("@strudel/tonal"),
    // xfade lives in the webaudio layer, which needs a browser AudioContext.
    // The stub keeps transition code evaluable; only syntax is under test.
    { xfade: (from: EvaluatedPattern) => from },
  );
  safeScope = createSafeStrudelScope({
    ...strudelScope,
  });
});

async function evaluatePattern(code: string): Promise<EvaluatedPattern> {
  const pattern = evaluateSafeStrudelExpression(code, safeScope);
  if (!isEvaluatedPattern(pattern)) {
    throw new Error("safe expression did not produce a Strudel pattern");
  }
  return pattern;
}

function isEvaluatedPattern(value: SafeStrudelValue): value is EvaluatedPattern {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryArc" in value &&
    typeof value.queryArc === "function"
  );
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

describe("desktop presets", () => {
  it.each(Object.entries(PRESET_PATTERNS))(
    "%s evaluates to a pattern with events",
    async (_name, code) => {
      const pattern = await evaluatePattern(code);
      expect(pattern.queryArc(0, 4).length).toBeGreaterThan(0);
    },
  );
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
