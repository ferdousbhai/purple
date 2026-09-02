import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Violet-tuned editor themes matching the app palette. Only content-level
 * colors live here (syntax, selection); the editor chrome - background,
 * gutters, active line, cursor - is themed by each app's own CSS against its
 * runtime palette tokens, so this module must not restate it.
 */

interface SyntaxPalette {
  call: string;
  string: string;
  number: string;
  keyword: string;
  comment: string;
  punctuation: string;
  selection: string;
}

function purpleEditorTheme(palette: SyntaxPalette, dark: boolean): Extension {
  return [
    EditorView.theme(
      {
        "& .cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          background: palette.selection,
        },
      },
      { dark },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        {
          tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
          color: palette.call,
        },
        { tag: tags.string, color: palette.string },
        { tag: [tags.number, tags.bool, tags.null], color: palette.number },
        { tag: [tags.keyword, tags.operator], color: palette.keyword },
        { tag: tags.comment, color: palette.comment, fontStyle: "italic" },
        {
          tag: [tags.punctuation, tags.bracket, tags.propertyName],
          color: palette.punctuation,
        },
      ]),
    ),
  ];
}

function accentVar(fallback: string): string {
  return `var(--accent, ${fallback})`;
}

export const purpleEditorDark = purpleEditorTheme(
  {
    call: accentVar("#c77dff"),
    string: "#ffcf87",
    number: "#ff9ecb",
    keyword: "#9d8ec7",
    comment: "#7d738f",
    punctuation: "#8d84a3",
    selection: `color-mix(in srgb, ${accentVar("#c77dff")} 20%, transparent)`,
  },
  true,
);

export const purpleEditorLight = purpleEditorTheme(
  {
    call: accentVar("#6b21a8"),
    string: "#a05a00",
    number: "#b3266e",
    keyword: "#5b4a86",
    comment: "#8a819c",
    punctuation: "#6f6786",
    selection: `color-mix(in srgb, ${accentVar("#6b21a8")} 18%, transparent)`,
  },
  false,
);
