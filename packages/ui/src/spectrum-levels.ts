/**
 * Fold the analyser's linear FFT bins into logarithmic bands, one level per
 * bar in 0..1. Geometrically spaced bands give low frequencies more detail;
 * each reports its loudest bin.
 */
export function spectrumLevels(bins: Uint8Array, bars: number): number[] {
  const levels: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    // Rounded boundaries: powers like 32^(2/5) float to 3.999..., and the
    // first and last bands are pinned so every bin belongs to some band.
    const start = bar === 0 ? 0 : Math.round(bins.length ** (bar / bars));
    const end =
      bar === bars - 1
        ? bins.length
        : Math.max(start + 1, Math.round(bins.length ** ((bar + 1) / bars)));
    let peak = 0;
    for (let bin = start; bin < end && bin < bins.length; bin++) {
      peak = Math.max(peak, bins[bin] ?? 0);
    }
    levels.push(peak / 255);
  }
  return levels;
}
