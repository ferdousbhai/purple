import { describe, expect, it } from "vitest";
import { createSpectrumSampler } from "./spectrum-levels";

describe("spectrum sampling", () => {
  it("folds 32 bins into doubling-width bands and reports each band's peak", () => {
    const bins = new Uint8Array(32);
    bins[0] = 255; // band 0: bins 0-1
    bins[3] = 128; // band 1: bins 2-3
    bins[7] = 64; // band 2: bins 4-7
    bins[15] = 32; // band 3: bins 8-15
    bins[31] = 16; // band 4: bins 16-31

    expect(createSpectrumSampler(bins.length, 5)(bins)).toEqual([
      1,
      128 / 255,
      64 / 255,
      32 / 255,
      16 / 255,
    ]);
  });

  it("reports silence as zero across every band", () => {
    expect(createSpectrumSampler(32, 5)(new Uint8Array(32))).toEqual([0, 0, 0, 0, 0]);
  });

  it("covers the full range even when bands outnumber low bins", () => {
    const bins = new Uint8Array(8).fill(255);
    const levels = createSpectrumSampler(bins.length, 5)(bins);
    expect(levels).toHaveLength(5);
    expect(levels.every((level) => level === 1)).toBe(true);
  });
});

describe("cached spectrum sampling", () => {
  it("reuses output storage while following changing input without retaining peaks", () => {
    const sample = createSpectrumSampler(32, 5);
    const bins = new Uint8Array(32);
    bins[31] = 255;
    const levels = sample(bins);
    expect(levels).toEqual([0, 0, 0, 0, 1]);
    bins.fill(0);
    bins[0] = 128;
    expect(sample(bins)).toBe(levels);
    expect(levels).toEqual([128 / 255, 0, 0, 0, 0]);
  });

  it("keeps sparse and empty FFT layouts finite", () => {
    expect(createSpectrumSampler(0, 5)(new Uint8Array())).toEqual([0, 0, 0, 0, 0]);
    expect(createSpectrumSampler(8, 5)(new Uint8Array(8).fill(255))).toEqual([1, 1, 1, 1, 1]);
  });
});
