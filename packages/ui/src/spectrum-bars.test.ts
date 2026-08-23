import { describe, expect, it } from "vitest";
import { spectrumLevels } from "./spectrum-bars";

describe("spectrumLevels", () => {
  it("folds 32 bins into doubling-width bands and reports each band's peak", () => {
    const bins = new Uint8Array(32);
    bins[0] = 255; // band 0: bins 0-1
    bins[3] = 128; // band 1: bins 2-3
    bins[7] = 64; // band 2: bins 4-7
    bins[15] = 32; // band 3: bins 8-15
    bins[31] = 16; // band 4: bins 16-31

    expect(spectrumLevels(bins, 5)).toEqual([
      1,
      128 / 255,
      64 / 255,
      32 / 255,
      16 / 255,
    ]);
  });

  it("reports silence as zero across every band", () => {
    expect(spectrumLevels(new Uint8Array(32), 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("covers the full range even when bands outnumber low bins", () => {
    const bins = new Uint8Array(8).fill(255);
    const levels = spectrumLevels(bins, 5);
    expect(levels).toHaveLength(5);
    expect(levels.every((level) => level === 1)).toBe(true);
  });
});
