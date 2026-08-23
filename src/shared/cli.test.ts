import { describe, expect, it } from "vitest";
import {
  getRandomStartupPattern,
  parseCliArgs,
  isStrudelCode,
  PRESET_PATTERNS,
} from "./cli";

describe("cli parser", () => {
  it("detects direct strudel code", () => {
    expect(isStrudelCode('s("bd hh sd hh")')).toBe(true);
    expect(isStrudelCode('note("c3 e3 g3").s("piano")')).toBe(true);
    expect(isStrudelCode('stack(s("bd*4"), s("hh*8"))')).toBe(true);
    expect(isStrudelCode("make a chill lo-fi beat")).toBe(false);
  });

  it("parses direct code argument", () => {
    const res = parseCliArgs(['s("bd hh sd hh")']);
    expect(res.initialCode).toBe('s("bd hh sd hh")');
    expect(res.requestPlayback).toBe(true);
  });

  it("parses preset name argument", () => {
    const res = parseCliArgs(["lofi"]);
    expect(res.initialCode).toBe(PRESET_PATTERNS.lofi);
    expect(res.requestPlayback).toBe(true);
  });

  it("parses --preset flag", () => {
    const res = parseCliArgs(["--preset", "basic"]);
    expect(res.initialCode).toBe(PRESET_PATTERNS.basic);
    expect(res.requestPlayback).toBe(true);
  });

  it("parses --code / -e flag", () => {
    const res = parseCliArgs(["-e", 'note("c4 d4 e4")']);
    expect(res.initialCode).toBe('note("c4 d4 e4")');
    expect(res.requestPlayback).toBe(true);
  });

  it("parses natural language prompt", () => {
    const res = parseCliArgs(["make a chill synthwave track"]);
    expect(res.initialPrompt).toBe("make a chill synthwave track");
    expect(res.requestPlayback).toBe(true);
  });

  it.each([
    ["positional", ["make", "a", "house", "beat"]],
    ["--prompt", ["--prompt", "make", "a", "house", "beat"]],
  ])("joins unquoted %s prompt arguments", (_kind, args) => {
    expect(parseCliArgs(args)).toEqual({
      initialPrompt: "make a house beat",
      requestPlayback: true,
    });
  });

  it("carries no content for a bare launch - startup policy is the controller's", () => {
    expect(parseCliArgs([])).toEqual({});
    expect(parseCliArgs([""])).toEqual({});
  });

  it("only chooses from the richer startup recipes", () => {
    const patterns = Array.from(
      { length: 8 },
      (_, index) => getRandomStartupPattern(() => index / 8),
    );

    expect(new Set(patterns).size).toBe(8);
    expect(patterns).not.toContain(PRESET_PATTERNS.basic);
  });

  it("rejects invalid flags instead of treating them as prompts", () => {
    expect(parseCliArgs(["--preset", "bogus"]).error).toContain(
      "Unknown preset",
    );
    expect(parseCliArgs(["--code"]).error).toContain("requires exactly one");
    expect(parseCliArgs(["--prompt"]).error).toContain("requires a prompt");
    expect(parseCliArgs(["--unknown"]).error).toContain("Unknown option");
  });
});
