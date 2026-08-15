import { memo, useCallback, useEffect, useRef, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { PlaybackControls } from "./PlaybackControls";
import {
  playbackHighlightExtension,
  updatePlaybackHighlights,
} from "../editor/playbackHighlight";
import type { PlaybackState, EvalResult, SourceRange } from "../../shared/types";

interface EditorPanelProps {
  code: string;
  onCodeChange: (code: string) => void;
  playbackState: PlaybackState;
  error: string | null;
  requiresUserActivation?: boolean;
  activeRanges: readonly SourceRange[];
  onPlay: (code: string) => Promise<EvalResult>;
  onStop: () => void;
}

const CODEMIRROR_BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: false,
  highlightActiveLine: true,
  autocompletion: false,
} as const;

export const EditorPanel = memo(function EditorPanel({
  code,
  onCodeChange,
  playbackState,
  error,
  requiresUserActivation = false,
  activeRanges,
  onPlay,
  onStop,
}: EditorPanelProps) {
  const codeRef = useRef(code);
  const playbackStateRef = useRef(playbackState);
  const editorViewRef = useRef<EditorView | null>(null);
  codeRef.current = code;
  playbackStateRef.current = playbackState;

  const handlePlay = useCallback(() => {
    if (playbackStateRef.current !== "loading" && codeRef.current.trim()) {
      void onPlay(codeRef.current);
    }
  }, [onPlay]);

  const extensions = useMemo(
    () => [
      javascript(),
      playbackHighlightExtension,
      keymap.of([
        {
          key: "Ctrl-Enter",
          run: () => {
            handlePlay();
            return true;
          },
        },
      ]),
    ],
    [handlePlay],
  );

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    updatePlaybackHighlights(view, activeRanges);
  }, [activeRanges]);

  return (
    <div className="flex flex-col h-full bg-surface-light/50 relative">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neon-cyan/10 bg-surface/60">
        <div className="flex items-center gap-2">
          <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-neon-cyan/60" />
          <span className="text-[11px] font-mono font-medium text-neon-cyan/70 tracking-widest uppercase">
            Pattern Editor
          </span>
        </div>
        <PlaybackControls
          playbackState={playbackState}
          requiresUserActivation={requiresUserActivation}
          onPlay={handlePlay}
          onStop={onStop}
        />
      </div>

      <div className="flex-1 overflow-hidden">
        <CodeMirror
          value={code}
          onChange={onCodeChange}
          theme={oneDark}
          extensions={extensions}
          basicSetup={CODEMIRROR_BASIC_SETUP}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
            updatePlaybackHighlights(view, activeRanges);
          }}
          className="h-full"
        />
      </div>

      {error && playbackState === "error" && (
        <div role="alert" className="px-4 py-2 text-xs font-mono text-neon-magenta bg-neon-magenta/10 border-t border-neon-magenta/20 truncate border-glow-magenta">
          <span className="text-neon-magenta/60 mr-2">ERR</span>
          {error}
        </div>
      )}

      {requiresUserActivation && playbackState !== "error" && (
        <div role="status" className="px-4 py-2 text-xs font-mono text-neon-amber bg-neon-amber/10 border-t border-neon-amber/20">
          Pattern ready — click START AUDIO to begin playback.
        </div>
      )}

      {playbackState === "playing" && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-neon-lime/0 via-neon-lime/60 to-neon-lime/0 animate-glow-pulse" />
      )}
    </div>
  );
});
