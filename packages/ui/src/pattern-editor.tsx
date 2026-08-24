import { javascript } from "@codemirror/lang-javascript";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import type { SourceRange } from "@purple/core/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { purpleEditorDark, purpleEditorLight } from "./editor-theme";
import {
  playbackHighlightExtension,
  updatePlaybackHighlights,
} from "./playback-highlight";

const BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: false,
  highlightActiveLine: true,
  autocompletion: false,
} as const;

export interface PatternEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  playbackHighlightActive: boolean;
  getActiveSourceRanges: () => readonly SourceRange[];
  onEvaluate: () => void;
  className?: string;
  /** Wrap long lines instead of scrolling sideways - the readable choice on
   * touch-width screens. */
  wrapLines?: boolean;
}

export function PatternEditor({
  code,
  onCodeChange,
  playbackHighlightActive,
  getActiveSourceRanges,
  onEvaluate,
  className,
  wrapLines = false,
}: PatternEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const [darkTheme, setDarkTheme] = useState(prefersDarkEditor);
  const evaluateRef = useRef(onEvaluate);
  evaluateRef.current = onEvaluate;

  const extensions = useMemo(
    () => [
      javascript(),
      playbackHighlightExtension,
      ...(wrapLines ? [EditorView.lineWrapping] : []),
      Prec.high(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              evaluateRef.current();
              return true;
            },
          },
        ]),
      ),
    ],
    [wrapLines],
  );

  // CodeMirror owns decoration state outside React. Poll the scheduler beside
  // the editor and dispatch decorations directly, so playback does not trigger
  // an application-wide React render every 50 ms.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!playbackHighlightActive) {
      updatePlaybackHighlights(view, []);
      return;
    }

    let lastKey = "";
    const update = () => {
      const ranges = getActiveSourceRanges();
      const key = getRangesKey(ranges);
      if (key === lastKey) return;
      lastKey = key;
      updatePlaybackHighlights(view, ranges);
    };
    update();
    const intervalId = window.setInterval(update, 50);
    return () => window.clearInterval(intervalId);
  }, [getActiveSourceRanges, playbackHighlightActive]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDarkTheme(prefersDarkEditor());
    const observer = new MutationObserver(update);
    media.addEventListener("change", update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme"],
    });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return (
    <CodeMirror
      value={code}
      height="100%"
      theme={darkTheme ? purpleEditorDark : purpleEditorLight}
      extensions={extensions}
      basicSetup={BASIC_SETUP}
      onChange={onCodeChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
        updatePlaybackHighlights(
          view,
          playbackHighlightActive ? getActiveSourceRanges() : [],
        );
      }}
      className={className}
    />
  );
}

function getRangesKey(ranges: readonly SourceRange[]): string {
  return ranges.map((range) => range.join(":")).join("|");
}

function prefersDarkEditor(): boolean {
  const explicit = document.documentElement.dataset.colorScheme;
  if (explicit === "light") return false;
  if (explicit === "dark") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
