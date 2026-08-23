import type { PlaybackState } from "../../shared/types";
import { DEFAULT_TRANSITION_CYCLES } from "@purple/core/transitions";

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
              bg-accent/15 hover:bg-accent/25 text-accent
              border border-accent/30 hover:border-accent/60
              rounded transition-all hover:shadow-glow-accent"
          title={`xfade over ${DEFAULT_TRANSITION_CYCLES} cycles`}
        >
          <span aria-hidden="true">↝</span>
          XFADE
        </button>
      )}

      {isTransitioning && (
        <span
          role="status"
          className="px-2 py-1 text-[10px] font-mono tracking-wider text-accent"
        >
          ↝ XFADING
        </span>
      )}

      {isPlaying || isTransitioning ? (
        <button
          type="button"
          onClick={onStop}
          className="group flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium
            bg-hot/15 hover:bg-hot/25 text-hot
            border border-hot/30 hover:border-hot/60
            rounded transition-all hover:shadow-glow-hot"
          title="Stop (Ctrl+.)"
        >
          <span aria-hidden="true" className="inline-block w-2 h-2 bg-hot rounded-[1px]" />
          STOP
        </button>
      ) : (
        <button
          type="button"
          onClick={onPlay}
          disabled={isLoading || isTransitioning}
          className="group flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium
            bg-active/10 hover:bg-active/20 text-active
            border border-active/30 hover:border-active/60
            rounded transition-all hover:shadow-glow-active
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
