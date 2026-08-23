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
  activeRanges: readonly SourceRange[];
  onEvaluate: () => void;
  className?: string;
  /** Wrap long lines instead of scrolling sideways - the readable choice on
   * touch-width screens. */
  wrapLines?: boolean;
}

export function PatternEditor({
  code,
  onCodeChange,
  activeRanges,
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

  // CodeMirror owns decoration state outside React, so scheduler ranges need
  // to be dispatched into the existing view instead of rendered as props.
  useEffect(() => {
    const view = viewRef.current;
    if (view) updatePlaybackHighlights(view, activeRanges);
  }, [activeRanges]);

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
        updatePlaybackHighlights(view, activeRanges);
      }}
      className={className}
    />
  );
}

function prefersDarkEditor(): boolean {
  const explicit = document.documentElement.dataset.colorScheme;
  if (explicit === "light") return false;
  if (explicit === "dark") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
