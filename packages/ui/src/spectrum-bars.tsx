import { useEffect, useRef, useState } from "react";

/**
 * Fold the analyser's linear FFT bins into logarithmic bands, one level per
 * bar in 0..1. Musical energy sits in the low bins, so each band spans twice
 * the bins of the one before it and reports its loudest bin.
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

const MIN_SCALE = 0.15;

export interface SpectrumBarsProps {
  /** Polled once on mount; return null to keep the host's CSS fallback. */
  getAnalyser: () => AnalyserNode | null;
  bars?: number;
  className?: string;
  barClassName?: string;
}

/**
 * The real output spectrum, drawn as `bars` spans scaled every animation
 * frame outside of React state. When no analyser exists (engine still
 * loading, or the tap failed) the spans keep whatever idle animation the
 * host's stylesheet gives them; the `live` class marks the driven state so
 * that animation can be scoped out.
 */
export function SpectrumBars({
  getAnalyser,
  bars = 5,
  className,
  barClassName,
}: SpectrumBarsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [analyser] = useState(getAnalyser);

  useEffect(() => {
    if (!analyser) return;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let frame = requestAnimationFrame(function tick() {
      analyser.getByteFrequencyData(bins);
      const spans = containerRef.current?.children ?? [];
      spectrumLevels(bins, bars).forEach((level, index) => {
        const span = spans[index];
        if (span instanceof HTMLElement) {
          span.style.transform = `scaleY(${MIN_SCALE + (1 - MIN_SCALE) * level})`;
        }
      });
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [analyser, bars]);

  return (
    <div
      aria-hidden="true"
      ref={containerRef}
      className={[className, analyser ? "live" : null].filter(Boolean).join(" ")}
    >
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} className={barClassName} />
      ))}
    </div>
  );
}
