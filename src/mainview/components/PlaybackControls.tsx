import type { PlaybackState } from "../../shared/types";
import {
  DEFAULT_TRANSITION_CYCLES,
  TRANSITION_CYCLE_OPTIONS,
} from "../transition";
import { useState } from "react";

interface PlaybackControlsProps {
  playbackState: PlaybackState;
  requiresUserActivation?: boolean;
  hasPendingPattern?: boolean;
  onPlay: () => void;
  onTransition: (durationCycles: number) => void;
  onStop: () => void;
}

export function PlaybackControls({
  playbackState,
  requiresUserActivation = false,
  hasPendingPattern = false,
  onPlay,
  onTransition,
  onStop,
}: PlaybackControlsProps) {
  const isPlaying = playbackState === "playing";
  const isLoading = playbackState === "loading";
  const isTransitioning = playbackState === "transitioning";
  const [transitionCycles, setTransitionCycles] = useState(
    DEFAULT_TRANSITION_CYCLES,
  );

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isPlaying && hasPendingPattern && (
        <>
          <label className="sr-only" htmlFor="transition-cycles">
            Transition length
          </label>
          <select
            id="transition-cycles"
            value={transitionCycles}
            onChange={(event) => setTransitionCycles(Number(event.target.value))}
            title="Transition length in musical cycles"
            className="h-7 rounded border border-neon-cyan/25 bg-surface-lighter/70 px-1
              text-[10px] font-mono text-neon-cyan focus:outline-none focus:border-neon-cyan/60"
          >
            {TRANSITION_CYCLE_OPTIONS.map((cycles) => (
              <option key={cycles} value={cycles}>
                {cycles}C
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onTransition(transitionCycles)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium
              bg-neon-cyan/15 hover:bg-neon-cyan/25 text-neon-cyan
              border border-neon-cyan/30 hover:border-neon-cyan/60
              rounded transition-all hover:shadow-[0_0_12px_#00fff540]"
            title={`Mix in the staged pattern over ${transitionCycles} cycles`}
          >
            <span aria-hidden="true">↝</span>
            MIX IN
          </button>
        </>
      )}

      {isTransitioning && (
        <span
          role="status"
          className="px-2 py-1 text-[10px] font-mono tracking-wider text-neon-cyan"
        >
          ↝ MIXING
        </span>
      )}

      {isPlaying || isTransitioning ? (
        <button
          type="button"
          onClick={onStop}
          className="group flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium
            bg-neon-magenta/15 hover:bg-neon-magenta/25 text-neon-magenta
            border border-neon-magenta/30 hover:border-neon-magenta/60
            rounded transition-all hover:shadow-[0_0_12px_#ff2d9540]"
          title="Stop (Ctrl+.)"
        >
          <span aria-hidden="true" className="inline-block w-2 h-2 bg-neon-magenta rounded-[1px]" />
          STOP
        </button>
      ) : (
        <button
          type="button"
          onClick={onPlay}
          disabled={isLoading || isTransitioning}
          className="group flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium
            bg-neon-lime/10 hover:bg-neon-lime/20 text-neon-lime
            border border-neon-lime/30 hover:border-neon-lime/60
            rounded transition-all hover:shadow-[0_0_12px_#39ff1440]
            disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
          title="Play (Ctrl+Enter)"
        >
          <span aria-hidden="true" className="inline-block w-0 h-0 border-l-[7px] border-l-current border-y-[4px] border-y-transparent" />
          {isLoading
            ? "INIT..."
            : requiresUserActivation
              ? "START"
              : "PLAY"}
        </button>
      )}
    </div>
  );
}
