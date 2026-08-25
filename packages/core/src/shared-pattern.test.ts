import { describe, expect, it } from "vitest";
import {
  parsePatternVoteResult,
  parseSharedPattern,
  parseSharedPatternDraft,
  parseSharedPatternPage,
} from "./shared-pattern";

const pattern = {
  id: "Abc_123-xYz9",
  title: "Acid rain",
  code: 's("bd*4")',
  createdAt: 1,
  likes: 4,
  dislikes: 1,
  score: 3,
  viewerVote: 1,
};

describe("shared pattern parsing", () => {
  it("normalizes a bounded draft", () => {
    expect(parseSharedPatternDraft({
      title: "  Acid rain  ",
      code: '  s("bd*4")  ',
    })).toEqual({ title: "Acid rain", code: 's("bd*4")' });
  });

  it("rejects malformed identifiers, votes and oversized code", () => {
    expect(parseSharedPattern({ ...pattern, id: "short" })).toBeNull();
    expect(parseSharedPattern({ ...pattern, viewerVote: 2 })).toBeNull();
    expect(parseSharedPatternDraft({
      title: "Acid rain",
      code: "x".repeat(30_001),
    })).toBeNull();
  });

  it("decodes pages and vote results without accepting partial data", () => {
    expect(parseSharedPatternPage({ patterns: [pattern], nextCursor: "next" }))
      .toEqual({ patterns: [pattern], nextCursor: "next" });
    expect(parseSharedPatternPage({ patterns: [{ ...pattern, likes: "4" }], nextCursor: null }))
      .toBeNull();
    expect(parsePatternVoteResult(pattern)).toEqual({
      likes: 4,
      dislikes: 1,
      score: 3,
      viewerVote: 1,
    });
  });
});
