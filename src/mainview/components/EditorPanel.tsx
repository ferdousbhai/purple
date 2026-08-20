import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { PlaybackControls } from "./PlaybackControls";
import {
  playbackHighlightExtension,
  updatePlaybackHighlights,
} from "@purple/ui/playback-highlight";
import type {
  PlaybackState,
  EvalResult,
  SavePatternResult,
  SourceRange,
} from "../../shared/types";

type TitleStatus = "idle" | "generating" | "ready" | "error";
type SaveState =
  | { status: "idle" | "saving" }
  | { status: "saved"; path: string }
  | { status: "error"; error: string };

interface EditorPanelProps {
  code: string;
  onCodeChange: (code: string) => void;
  patternTitle: string;
  titleStatus: TitleStatus;
  titleError: string | null;
  onTitleChange: (title: string) => void;
  onSavePattern: (title: string, code: string) => Promise<SavePatternResult>;
  playbackState: PlaybackState;
  error: string | null;
  requiresUserActivation?: boolean;
  hasPendingPattern?: boolean;
  activeRanges: readonly SourceRange[];
  onPlay: (code: string) => Promise<EvalResult>;
  onTransition: (code: string, durationCycles: number) => Promise<EvalResult>;
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
  patternTitle,
  titleStatus,
  titleError,
  onTitleChange,
  onSavePattern,
  playbackState,
  error,
  requiresUserActivation = false,
  hasPendingPattern = false,
  activeRanges,
  onPlay,
  onTransition,
  onStop,
}: EditorPanelProps) {
  const codeRef = useRef(code);
  const playbackStateRef = useRef(playbackState);
  const editorViewRef = useRef<EditorView | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  codeRef.current = code;
  playbackStateRef.current = playbackState;

  const handlePlay = useCallback(() => {
    if (
      playbackStateRef.current !== "loading" &&
      playbackStateRef.current !== "transitioning" &&
      codeRef.current.trim()
    ) {
      void onPlay(codeRef.current);
    }
  }, [onPlay]);

  const handleSave = useCallback(async () => {
    const title = patternTitle.trim();
    const patternCode = codeRef.current.trim();
    if (!title || !patternCode || saveState.status === "saving") return;

    setSaveState({ status: "saving" });
    try {
      const result = await onSavePattern(title, patternCode);
      if (result.ok) {
        setSaveState({ status: "saved", path: result.path });
      } else if (result.cancelled) {
        setSaveState({ status: "idle" });
      } else {
        setSaveState({ status: "error", error: result.error });
      }
    } catch (error) {
      setSaveState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [onSavePattern, patternTitle, saveState.status]);

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
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-neon-cyan/10 bg-surface/60">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-neon-cyan/60" />
          <label className="sr-only" htmlFor="pattern-title">
            Pattern title
          </label>
          <input
            id="pattern-title"
            value={patternTitle}
            maxLength={60}
            onChange={(event) => {
              setSaveState({ status: "idle" });
              onTitleChange(event.target.value);
            }}
            placeholder={
              titleStatus === "generating"
                ? "Generating title…"
                : "Untitled pattern"
            }
            className="min-w-0 w-full max-w-sm bg-transparent text-xs font-display font-medium
              tracking-wide text-white/85 placeholder-neon-cyan/35 focus:outline-none
              focus:text-neon-cyan"
          />
          {titleStatus === "generating" && (
            <span
              aria-label="Generating pattern title"
              className="shrink-0 text-[10px] font-mono text-neon-cyan/50"
            >
              ···
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={
            saveState.status === "saving" ||
            !patternTitle.trim() ||
            !code.trim()
          }
          title="Choose a folder and save this pattern as a .strudel file"
          className="px-2.5 py-1 text-[10px] font-mono font-medium tracking-wider
            bg-white/5 hover:bg-neon-cyan/10 text-white/55 hover:text-neon-cyan
            border border-white/10 hover:border-neon-cyan/40 rounded transition-all
            disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saveState.status === "saving" ? "SAVING…" : "SAVE"}
        </button>
        <PlaybackControls
          playbackState={playbackState}
          requiresUserActivation={requiresUserActivation}
          hasPendingPattern={hasPendingPattern}
          onPlay={handlePlay}
          onTransition={(durationCycles) => {
            void onTransition(codeRef.current, durationCycles);
          }}
          onStop={onStop}
        />
      </div>

      <div className="flex-1 overflow-hidden">
        <CodeMirror
          value={code}
          onChange={(nextCode) => {
            setSaveState({ status: "idle" });
            onCodeChange(nextCode);
          }}
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

      {error && (
        <div role="alert" className="px-4 py-2 text-xs font-mono text-neon-magenta bg-neon-magenta/10 border-t border-neon-magenta/20 truncate border-glow-magenta">
          <span className="text-neon-magenta/60 mr-2">ERR</span>
          {error}
        </div>
      )}

      {titleStatus === "error" && titleError && (
        <div role="alert" className="px-4 py-2 text-xs font-mono text-neon-magenta bg-neon-magenta/10 border-t border-neon-magenta/20 truncate">
          <span className="text-neon-magenta/60 mr-2">TITLE ERR</span>
          {titleError}
        </div>
      )}

      {saveState.status === "error" && (
        <div role="alert" className="px-4 py-2 text-xs font-mono text-neon-magenta bg-neon-magenta/10 border-t border-neon-magenta/20 truncate">
          <span className="text-neon-magenta/60 mr-2">SAVE ERR</span>
          {saveState.error}
        </div>
      )}

      {saveState.status === "saved" && (
        <div role="status" title={saveState.path} className="px-4 py-2 text-xs font-mono text-neon-lime bg-neon-lime/10 border-t border-neon-lime/20 truncate">
          <span className="text-neon-lime/60 mr-2">SAVED</span>
          {savedFilename(saveState.path)}
        </div>
      )}

      {requiresUserActivation && playbackState !== "error" && (
        <div role="status" className="px-4 py-2 text-xs font-mono text-neon-amber bg-neon-amber/10 border-t border-neon-amber/20">
          Pattern ready — click START to begin playback.
        </div>
      )}

      {(playbackState === "playing" || playbackState === "transitioning") && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-neon-lime/0 via-neon-lime/60 to-neon-lime/0 animate-glow-pulse" />
      )}
    </div>
  );
});

function savedFilename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
