import type { PlaybackState } from "../../shared/types";
import { DEFAULT_TRANSITION_CYCLES } from "../transition";

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

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isPlaying && hasPendingPattern && (
        <button
          type="button"
          onClick={() => onTransition(DEFAULT_TRANSITION_CYCLES)}
          className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium
              bg-neon-cyan/15 hover:bg-neon-cyan/25 text-neon-cyan
              border border-neon-cyan/30 hover:border-neon-cyan/60
              rounded transition-all hover:shadow-[0_0_12px_#00fff540]"
          title={`xfade over ${DEFAULT_TRANSITION_CYCLES} cycles`}
        >
          <span aria-hidden="true">↝</span>
          XFADE
        </button>
      )}

      {isTransitioning && (
        <span
          role="status"
          className="px-2 py-1 text-[10px] font-mono tracking-wider text-neon-cyan"
        >
          ↝ XFADING
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
