import { describe, expect, it } from "vitest";
import { auditHapSounds, closestSoundNames } from "./validation";
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

