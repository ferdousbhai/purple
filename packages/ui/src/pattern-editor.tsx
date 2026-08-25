import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  highlightSelectionMatches,
  searchKeymap,
} from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import type { SourceRange } from "@purple/core/types";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { purpleEditorDark, purpleEditorLight } from "./editor-theme";
import {
  playbackHighlightExtension,
  updatePlaybackHighlights,
} from "./playback-highlight";

const externalChange = Annotation.define<boolean>();

// Keep only the editor capabilities Purple exposes. The convenience basic
// setup also installs search, lint, completion, folding, and their keymaps.
const EDITOR_SETUP: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
  ]),
  EditorView.contentAttributes.of({ "aria-label": "Pattern code" }),
  EditorView.theme({
    "&": { height: "100%" },
    ".cm-scroller": { height: "100%" },
  }),
];

export interface PatternEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  playbackHighlightActive: boolean;
  getActiveSourceRanges: () => readonly SourceRange[];
  onEvaluate: () => void;
  className?: string;
  /** Streamed model prefixes are display-only until the pattern is complete. */
  readOnly?: boolean;
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
  readOnly = false,
  wrapLines = false,
}: PatternEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef(code);
  const onCodeChangeRef = useRef(onCodeChange);
  const evaluateRef = useRef(onEvaluate);
  const getActiveSourceRangesRef = useRef(getActiveSourceRanges);
  const readOnlyRef = useRef(readOnly);
  const [darkTheme, setDarkTheme] = useState(prefersDarkEditor);
  const [compartments] = useState(() => ({
    appearance: new Compartment(),
    editability: new Compartment(),
  }));
  const appliedConfigurationRef = useRef({ darkTheme, readOnly, wrapLines });
  codeRef.current = code;
  onCodeChangeRef.current = onCodeChange;
  evaluateRef.current = onEvaluate;
  getActiveSourceRangesRef.current = getActiveSourceRanges;
  readOnlyRef.current = readOnly;

  useLayoutEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const view = new EditorView({
      parent,
      doc: codeRef.current,
      extensions: [
        EDITOR_SETUP,
        javascript(),
        playbackHighlightExtension,
        compartments.appearance.of(appearanceExtensions(darkTheme, wrapLines)),
        compartments.editability.of(editabilityExtensions(readOnly)),
        Prec.high(
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                if (readOnlyRef.current) return false;
                evaluateRef.current();
                return true;
              },
            },
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (
            update.transactions.some((transaction) =>
              transaction.annotation(externalChange),
            )
          ) {
            return;
          }
          onCodeChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [compartments]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentCode = view.state.doc.toString();
    if (currentCode === code) return;
    view.dispatch({
      changes: { from: 0, to: currentCode.length, insert: code },
      annotations: [
        externalChange.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
  }, [code]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const applied = appliedConfigurationRef.current;
    if (
      applied.darkTheme === darkTheme &&
      applied.readOnly === readOnly &&
      applied.wrapLines === wrapLines
    ) {
      return;
    }
    view.dispatch({
      effects: [
        compartments.appearance.reconfigure(
          appearanceExtensions(darkTheme, wrapLines),
        ),
        compartments.editability.reconfigure(editabilityExtensions(readOnly)),
      ],
    });
    appliedConfigurationRef.current = { darkTheme, readOnly, wrapLines };
  }, [compartments, darkTheme, readOnly, wrapLines]);

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
      const ranges = getActiveSourceRangesRef.current();
      const key = getRangesKey(ranges);
      if (key === lastKey) return;
      lastKey = key;
      updatePlaybackHighlights(view, ranges);
    };
    update();
    const intervalId = window.setInterval(update, 50);
    return () => window.clearInterval(intervalId);
  }, [playbackHighlightActive]);

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
    <div
      className={className ? `cm-theme ${className}` : "cm-theme"}
      ref={containerRef}
    />
  );
}

function appearanceExtensions(darkTheme: boolean, wrapLines: boolean): Extension {
  return [
    darkTheme ? purpleEditorDark : purpleEditorLight,
    ...(wrapLines ? [EditorView.lineWrapping] : []),
  ];
}

function editabilityExtensions(readOnly: boolean): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];
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
