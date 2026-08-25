import { describe, expect, it, vi } from "vitest";
import {
  createPatternStreamDecoder,
  formatGeneratedTurn,
  parseGeneratedTurn,
  visibleGeneratedTurnExplanation,
} from "./turn";

const suggestions = [
  { label: "Drift to dub", prompt: "Continue as spacious dub" },
  { label: "Lift the pulse", prompt: "Continue as bright house" },
  { label: "Melt to ambient", prompt: "Continue as soft ambient" },
];

describe("structured studio turns", () => {
  it("parses metadata but keeps only the pattern and explanation in history", () => {
    const turn = parseGeneratedTurn(JSON.stringify({
      pattern: 's("bd*4")',
      progression: {
        afterCycles: 1_856,
        nextAction: "Strip back to bass and filtered drums",
      },
      title: "Night Transit",
      suggestions,
      explanation: "A driving late-night groove.",
    }));

    expect(turn).toEqual({
      pattern: 's("bd*4")',
      progression: {
        afterCycles: 1_856,
        nextAction: "Strip back to bass and filtered drums",
      },
      title: "Night Transit",
      suggestions,
      explanation: "A driving late-night groove.",
    });
    expect(formatGeneratedTurn(turn!)).toBe(
      '```strudel\ns("bd*4")\n```\nA driving late-night groove.',
    );
  });

  it("shows only the explanation from legacy structured transcripts", () => {
    const legacy = [
      '```strudel',
      's("bd*4")',
      '```',
      'Title: Night Transit',
      'A driving late-night groove.',
      'Next after 1856 cycles: Strip back to bass and filtered drums',
    ].join("\n");

    expect(visibleGeneratedTurnExplanation(legacy)).toBe(
      "A driving late-night groove.",
    );
  });

  it("keeps a decoded pattern when later metadata is truncated", () => {
    expect(parseGeneratedTurn('{"pattern":"s(\\"bd\\")",', 's("bd")')).toEqual({
      pattern: 's("bd")',
      progression: null,
      title: null,
      suggestions: [],
      explanation: "",
    });
  });
});

describe("leading pattern stream decoder", () => {
  it("streams decoded text across split escapes and completes before metadata", () => {
    const onDelta = vi.fn();
    const onComplete = vi.fn();
    const decoder = createPatternStreamDecoder({ onDelta, onComplete });

    decoder.push(' { \n "pattern" : "stack(\\n  s(\\"bd');
    decoder.push('*4\\"),\\n  note(\\"c4\\") // ');
    decoder.push('spark \\ud83d');
    expect(onDelta).not.toHaveBeenCalledWith("\ud83d");
    decoder.push('\\udcab\\n)" , "title": "Later"');

    expect(onDelta.mock.calls.map(([delta]) => delta).join("")).toBe(
      'stack(\n  s("bd*4"),\n  note("c4") // spark 💫\n)',
    );
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(
      'stack(\n  s("bd*4"),\n  note("c4") // spark 💫\n)',
    );
    expect(decoder.pattern()).toBe(
      'stack(\n  s("bd*4"),\n  note("c4") // spark 💫\n)',
    );
  });

  it("does not treat later fields as the streamable pattern", () => {
    const onDelta = vi.fn();
    const decoder = createPatternStreamDecoder({
      onDelta,
      onComplete: vi.fn(),
    });
    decoder.push('{"title":"Too early","pattern":"s(\\"bd\\")"}');
    expect(onDelta).not.toHaveBeenCalled();
    expect(decoder.pattern()).toBeNull();
  });
});
