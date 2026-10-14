import { useEffect, useRef } from "react";
import { spectrumLevels } from "./spectrum-levels";

interface AudioVisualizerProps {
  active: boolean;
  getAnalyser: () => AnalyserNode | null;
}

/** Observe the master mix without adding another audio route or React renders per frame. */
export function AudioVisualizer({ active, getAnalyser }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let width = 0;
    let height = 0;
    const inset = 16;
    let plotWidth = 0;
    let waveY = 0;
    let spectrumY = 0;
    let waveHeight = 0;
    let barHeight = 0;
    let bands = 1;
    let step = 0;
    let accent = "";
    let ink = "";
    let gradient: CanvasGradient;
    let analyser: AnalyserNode | null = null;
    let bins = new Uint8Array(0);
    let samples = new Uint8Array(0);

    const draw = () => {
      context.clearRect(0, 0, width, height);
      if (!width || !height) return;
      // The engine initializes after a user gesture and can replace its context.
      // Resolve the tap each frame, rather than retaining a stale analyser.
      const current = active && !document.hidden && !motion.matches
        ? getAnalyser()
        : null;
      if (current !== analyser) {
        analyser = current;
        bins = new Uint8Array(analyser?.frequencyBinCount ?? 0);
        samples = new Uint8Array(analyser?.fftSize ?? 0);
      }
      if (analyser) {
        analyser.getByteFrequencyData(bins);
        analyser.getByteTimeDomainData(samples);
      }
      context.strokeStyle = accent;
      context.globalAlpha = 0.18;
      context.lineWidth = 1;
      for (const y of [waveY, spectrumY]) {
        context.beginPath();
        context.moveTo(inset, y);
        context.lineTo(width - inset, y);
        context.stroke();
      }

      const levels = analyser ? spectrumLevels(bins, bands) : [];
      context.fillStyle = gradient;
      for (let index = 0; index < bands; index++) {
        const level = levels[index] ?? 0;
        const size = Math.max(1, level * barHeight);
        context.globalAlpha = analyser ? 0.35 + level * 0.6 : 0.2;
        context.fillRect(inset + index * step, spectrumY - size, Math.max(1, step - 3), size * 2);
      }

      context.globalAlpha = analyser ? 0.85 : 0.25;
      context.strokeStyle = ink;
      context.lineWidth = 1.5;
      context.beginPath();
      if (analyser) {
        for (let index = 0; index < samples.length; index++) {
          const x = inset + (index / (samples.length - 1)) * plotWidth;
          const y = waveY + ((samples[index]! - 128) / 128) * waveHeight;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
      } else {
        context.moveTo(inset, waveY);
        context.lineTo(width - inset, waveY);
      }
      context.stroke();
      context.globalAlpha = 1;
    };

    const tick = () => {
      draw();
      frame = requestAnimationFrame(tick);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      draw();
      // No simulated motion in silence, hidden tabs, or reduced-motion mode.
      if (active && !document.hidden && !motion.matches) {
        frame = requestAnimationFrame(tick);
      }
    };
    const refreshColors = () => {
      const styles = getComputedStyle(canvas);
      accent = styles.getPropertyValue("--accent").trim() || "#c77dff";
      ink = styles.getPropertyValue("--text").trim() || "#eee7f5";
      gradient = context.createLinearGradient(0, spectrumY - barHeight, 0, spectrumY + barHeight);
      gradient.addColorStop(0, ink);
      gradient.addColorStop(0.5, accent);
      gradient.addColorStop(1, accent);
      restart();
    };
    const observer = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      plotWidth = Math.max(0, width - inset * 2);
      waveY = height * 0.24;
      spectrumY = height * 0.69;
      waveHeight = height * 0.16;
      barHeight = height * 0.25;
      // Roughly one band per 10 CSS pixels keeps bars readable at every width.
      bands = Math.max(1, Math.floor(plotWidth / 10));
      step = plotWidth / bands;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      refreshColors();
    });
    observer.observe(canvas);
    // Theme variables can be inherited from any ancestor of the canvas.
    const themeObserver = new MutationObserver(refreshColors);
    for (let element: Element | null = canvas; element; element = element.parentElement) {
      themeObserver.observe(element, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    }
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    colorScheme.addEventListener("change", refreshColors);
    document.addEventListener("visibilitychange", restart);
    motion.addEventListener("change", restart);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      themeObserver.disconnect();
      colorScheme.removeEventListener("change", refreshColors);
      document.removeEventListener("visibilitychange", restart);
      motion.removeEventListener("change", restart);
    };
  }, [active, getAnalyser]);

  return (
    <figure className={`audio-visualizer ${active ? "active" : "idle"}`} aria-label="Audio visualization">
      <figcaption>
        <span><i aria-hidden="true" />{active ? "LIVE OUTPUT" : "OUTPUT"}</span>
        <span>{active ? "WAVEFORM / SPECTRUM" : "PRESS PLAY TO VISUALIZE"}</span>
      </figcaption>
      <canvas ref={canvasRef} aria-hidden="true" />
    </figure>
  );
}
