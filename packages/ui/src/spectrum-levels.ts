/**
 * Fold the analyser's linear FFT bins into logarithmic bands, one level per
 * bar in 0..1. Geometrically spaced bands give low frequencies more detail;
 * each reports its loudest bin.
 *
 * Cache band boundaries and reuse levels while the analyser/layout stays fixed.
 * The returned array belongs to the sampler and is updated by the next sample. */
export function createSpectrumSampler(binCount: number, bars: number) {
  const starts: number[] = [];
  const ends: number[] = [];
  const levels: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    // Rounded boundaries: powers like 32^(2/5) float to 3.999..., and the
    // first and last bands are pinned so every bin belongs to some band.
    const start = bar === 0 ? 0 : Math.round(binCount ** (bar / bars));
    const end = bar === bars - 1
      ? binCount
      : Math.max(start + 1, Math.round(binCount ** ((bar + 1) / bars)));
    starts.push(start);
    ends.push(Math.min(end, binCount));
    levels.push(0);
  }
  return (bins: Uint8Array): number[] => {
    for (let bar = 0; bar < bars; bar++) {
      let peak = 0;
      for (let bin = starts[bar]!; bin < ends[bar]!; bin++) {
        peak = Math.max(peak, bins[bin] ?? 0);
      }
      levels[bar] = peak / 255;
    }
    return levels;
  };
}
