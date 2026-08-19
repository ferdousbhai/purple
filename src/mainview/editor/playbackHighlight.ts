import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { SourceRange } from "../../shared/types";

const setPlaybackRanges = StateEffect.define<readonly SourceRange[]>();

export const playbackHighlightExtension = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setPlaybackRanges)) continue;

      const builder = new RangeSetBuilder<Decoration>();
      for (const [from, to] of normalizeRanges(
        effect.value,
        transaction.state.doc.length,
      )) {
        builder.add(
          from,
          to,
          Decoration.mark({ class: "cm-playback-highlight" }),
        );
      }
      return builder.finish();
    }

    return transaction.docChanged
      ? decorations.map(transaction.changes)
      : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function updatePlaybackHighlights(
  view: EditorView,
  ranges: readonly SourceRange[],
) {
  view.dispatch({ effects: setPlaybackRanges.of(ranges) });
}

function normalizeRanges(ranges: readonly SourceRange[], documentLength: number) {
  const seen = new Set<string>();
  const normalized: SourceRange[] = [];

  for (const [rawFrom, rawTo] of ranges) {
    const from = clampOffset(rawFrom, documentLength);
    const to = clampOffset(rawTo, documentLength);
    if (to <= from) continue;

    const key = `${from}:${to}`;
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push([from, to]);
  }

  return normalized.sort(([fromA, toA], [fromB, toB]) =>
    fromA === fromB ? toA - toB : fromA - fromB,
  );
}

function clampOffset(value: number, documentLength: number) {
  return Math.max(0, Math.min(value, documentLength));
}
