import type { PlaybackState } from "../../shared/types";

interface PlaybackControlsProps {
  playbackState: PlaybackState;
  onPlay: () => void;
  onStop: () => void;
}

export function PlaybackControls({
  playbackState,
  onPlay,
  onStop,
}: PlaybackControlsProps) {
  const isPlaying = playbackState === "playing";
  const isLoading = playbackState === "loading";

  return (
    <div className="flex items-center gap-2">
      {isPlaying ? (
        <button
          onClick={onStop}
          className="group flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium
            bg-neon-magenta/15 hover:bg-neon-magenta/25 text-neon-magenta
            border border-neon-magenta/30 hover:border-neon-magenta/60
            rounded transition-all hover:shadow-[0_0_12px_#ff2d9540]"
          title="Stop (Ctrl+.)"
        >
          <span className="inline-block w-2 h-2 bg-neon-magenta rounded-[1px]" />
          STOP
        </button>
      ) : (
        <button
          onClick={onPlay}
          disabled={isLoading}
          className="group flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium
            bg-neon-lime/10 hover:bg-neon-lime/20 text-neon-lime
            border border-neon-lime/30 hover:border-neon-lime/60
            rounded transition-all hover:shadow-[0_0_12px_#39ff1440]
            disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
          title="Play (Ctrl+Enter)"
        >
          <span className="inline-block w-0 h-0 border-l-[7px] border-l-current border-y-[4px] border-y-transparent" />
          {isLoading ? "INIT..." : "PLAY"}
        </button>
      )}
    </div>
  );
}
