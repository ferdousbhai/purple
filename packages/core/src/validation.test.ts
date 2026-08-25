import { describe, expect, it } from "vitest";
import {
  auditHapSounds,
  buildValidationRetryMessage,
  closestSoundNames,
  type ValidationProblem,
} from "./validation";
import { MAX_RETRIES, repairUntilValid } from "./repair";
import type { AuditableHapValue } from "./validation";

const hap = (value: AuditableHapValue) => ({ value });

describe("auditHapSounds", () => {
  const registry = new Set(["bd", "piano", "rolandtr909_bd", "square"]);
  const hasSound = (name: string) => registry.has(name.toLowerCase());

  it("passes sounds the engine resolves, case folded like the engine", () => {
    const haps = [hap({ s: "bd" }), hap({ s: "PIANO" })];
    expect(auditHapSounds(haps, hasSound)).toEqual([]);
  });

  it("reports unknown names once each", () => {
    const haps = [hap({ s: "pianoz" }), hap({ s: "pianoz" }), hap({ s: "bd" })];
    expect(auditHapSounds(haps, hasSound)).toEqual(["pianoz"]);
  });

  it("resolves bank-prefixed names the way trigger time does", () => {
    const haps = [
      hap({ s: "bd", bank: "RolandTR909" }),
      hap({ s: "sh", bank: "RolandTR909" }),
    ];
    expect(auditHapSounds(haps, hasSound)).toEqual(["RolandTR909_sh"]);
  });

  it("ignores rests, mutes, note-only events, and non-sound haps", () => {
    const haps = [
      hap({ s: "~" }),
      hap({ s: "-" }),
      hap({ s: "_" }),
      hap({}),
      hap(null),
      hap(60),
      hap("bare"),
      { value: undefined },
      {},
    ];
    expect(auditHapSounds(haps, hasSound)).toEqual([]);
  });

  it("audits only the registry name from name:index:gain shorthand", () => {
    expect(auditHapSounds([hap({ s: "square:0:.5" })], hasSound)).toEqual([]);
    expect(auditHapSounds([hap({ s: "sqare:0:.5" })], hasSound)).toEqual([
      "sqare",
    ]);
  });
});

describe("closestSoundNames", () => {
  const available = ["piano", "pluck", "pad", "jvbass", "bd", "sn"];

  it("suggests near misses, best first", () => {
    expect(closestSoundNames("pianoz", available)).toEqual(["piano"]);
    expect(closestSoundNames("pluk", available)[0]).toBe("pluck");
  });

  it("offers nothing for names far from everything", () => {
    expect(closestSoundNames("gm_epiano1", available)).toEqual([]);
  });
});

describe("buildValidationRetryMessage", () => {
  it("names every problem and carries the original code", () => {
    const problems: ValidationProblem[] = [
      {
        kind: "unknown-sounds",
        sounds: [{ name: "pianoz", suggestions: ["piano"] }],
      },
      { kind: "empty" },
    ];
    const message = buildValidationRetryMessage('s("pianoz")', problems);
    expect(message).toContain('"pianoz"');
    expect(message).toContain('did you mean "piano"');
    expect(message).toContain("no events");
    expect(message).toContain('s("pianoz")');
    expect(message).not.toContain("documented palette");
    expect(message).not.toContain("no variable declarations");
  });

  it("sends safe-interpreter resource limits back to the model", () => {
    const error =
      "Pattern uses unsupported JavaScript near character 556: Mini-notation repetition exceeds the cumulative event multiplier limit of 512.";
    const message = buildValidationRetryMessage('s("bd*1024")', [
      { kind: "evaluation", error },
    ]);

    expect(message).toContain(error);
    expect(message).toContain('s("bd*1024")');
    expect(message).toContain("Repair this pattern");
  });
});

describe("repairUntilValid", () => {
  const unknownSound: ValidationProblem = {
    kind: "unknown-sounds",
    sounds: [{ name: "pianoz", suggestions: ["piano"] }],
  };

  it("returns immediately when the pattern is clean", async () => {
    const outcome = await repairUntilValid("good", {
      validate: async () => [],
      requestFix: async () => {
        throw new Error("must not request a fix");
      },
      applyFix: () => {
        throw new Error("must not apply a fix");
      },
      isStale: () => false,
    });
    expect(outcome).toEqual({ code: "good", problems: [], retriesUsed: 0 });
  });

  it("skips when the engine is not initialized", async () => {
    const outcome = await repairUntilValid("unchecked", {
      validate: async () => null,
      requestFix: async () => {
        throw new Error("must not request a fix");
      },
      applyFix: () => {},
      isStale: () => false,
    });
    expect(outcome).toEqual({
      code: "unchecked",
      problems: [],
      retriesUsed: 0,
    });
  });

  it("repairs until the audit comes back clean", async () => {
    const applied: string[] = [];
    const outcome = await repairUntilValid("bad", {
      validate: async (code) => (code === "fixed" ? [] : [unknownSound]),
      requestFix: async (message) => {
        expect(message).toContain('"pianoz"');
        return "fixed";
      },
      applyFix: (code) => applied.push(code),
      isStale: () => false,
    });
    expect(applied).toEqual(["fixed"]);
    expect(outcome).toEqual({ code: "fixed", problems: [], retriesUsed: 1 });
  });

  it("stops at the retry budget and reports remaining problems", async () => {
    let fixes = 0;
    const outcome = await repairUntilValid("bad", {
      validate: async () => [unknownSound],
      requestFix: async () => `fix-${++fixes}`,
      applyFix: () => {},
      isStale: () => false,
    });
    expect(fixes).toBe(MAX_RETRIES);
    expect(outcome.retriesUsed).toBe(MAX_RETRIES);
    expect(outcome.problems).toEqual([unknownSound]);
  });

  it("abandons the pattern when a newer prompt owns the editor", async () => {
    let stale = false;
    const outcome = await repairUntilValid("bad", {
      validate: async () => [unknownSound],
      requestFix: async () => {
        stale = true;
        return "fixed";
      },
      applyFix: () => {
        throw new Error("must not rewrite a newer prompt's pattern");
      },
      isStale: () => stale,
    });
    expect(outcome.code).toBe("bad");
    expect(outcome.retriesUsed).toBe(1);
  });
});
