import { describe, expect, it, vi } from "vitest";
import {
  buildCompactionRequest,
  buildContextWindow,
  COMPACTION_TRIGGER_TOKENS,
  COMPACTION_WARNING_TOKENS,
  createFoldScheduler,
  MAX_FOLD_FAILURES,
  parseCompactionSummary,
  planCompaction,
  shouldSuggestNewSession,
  SUMMARY_CONTEXT_PREFIX,
  type CompactionSummaryResult,
  type FoldSnapshot,
} from "./compaction";
import type { ChatMessage } from "./types";

const OVER_BUDGET = COMPACTION_TRIGGER_TOKENS + 1;

function conversation(length: number): ChatMessage[] {
  return Array.from({ length }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message ${index}`,
  }));
}

describe("planCompaction", () => {
  it("does not fold at or below the token budget, or before any count exists", () => {
    expect(planCompaction(4, 0, null)).toEqual({ fold: false, foldEnd: 0 });
    expect(planCompaction(4, 0, COMPACTION_TRIGGER_TOKENS)).toEqual({
      fold: false,
      foldEnd: 0,
    });
  });

  it("folds the entire conversation once the budget is exceeded", () => {
    expect(planCompaction(4, 0, OVER_BUDGET)).toEqual({
      fold: true,
      foldEnd: 4,
    });
  });

  it("never folds a lone uncovered message", () => {
    expect(planCompaction(5, 4, OVER_BUDGET)).toEqual({
      fold: false,
      foldEnd: 4,
    });
  });

  it("echoes the covered count when no fold is due", () => {
    expect(planCompaction(10, 4, null)).toEqual({ fold: false, foldEnd: 4 });
  });

  it("clamps an out-of-range covered count", () => {
    expect(planCompaction(5, 10, null)).toEqual({ fold: false, foldEnd: 5 });
    expect(planCompaction(5, -3, null)).toEqual({ fold: false, foldEnd: 0 });
  });
});

describe("shouldSuggestNewSession", () => {
  it("appears before compaction is due", () => {
    expect(
      shouldSuggestNewSession(4, 0, COMPACTION_WARNING_TOKENS - 1),
    ).toBe(false);
    expect(
      shouldSuggestNewSession(4, 0, COMPACTION_WARNING_TOKENS),
    ).toBe(true);
  });

  it("stays visible while a due fold is pending", () => {
    expect(shouldSuggestNewSession(4, 0, OVER_BUDGET)).toBe(true);
  });

  it("disappears after the long history is compacted", () => {
    expect(shouldSuggestNewSession(4, 4, OVER_BUDGET)).toBe(false);
  });

  it("does not appear without a token count or meaningful uncovered history", () => {
    expect(shouldSuggestNewSession(4, 0, null)).toBe(false);
    expect(shouldSuggestNewSession(4, 3, OVER_BUDGET)).toBe(false);
  });
});

describe("buildCompactionRequest", () => {
  it("marks a missing previous artifact and labels roles", () => {
    const request = buildCompactionRequest(null, conversation(2));
    expect(request).toContain("Previous summary:\n(none)");
    expect(request).toContain("Previous current pattern:\n(none)");
    expect(request).toContain("User: message 0");
    expect(request).toContain("Assistant: message 1");
  });

  it("carries the previous artifact forward", () => {
    const request = buildCompactionRequest(
      { summary: "Dub techno at 124 BPM.", latestPattern: 's("bd*4")' },
      [],
    );
    expect(request).toContain("Previous summary:\nDub techno at 124 BPM.");
    expect(request).toContain('Previous current pattern:\ns("bd*4")');
  });
});

describe("buildContextWindow", () => {
  it("sends the whole history when no artifact exists", () => {
    const messages = conversation(20);
    expect(buildContextWindow(null, 0, messages)).toEqual(messages);
  });

  it("treats a blank summary as no artifact", () => {
    const messages = conversation(20);
    expect(
      buildContextWindow({ summary: "  ", latestPattern: "x" }, 5, messages),
    ).toEqual(messages);
  });

  it("prepends summary and current pattern before the uncovered tail", () => {
    const messages = conversation(16);
    const window = buildContextWindow(
      { summary: "Lo-fi jazzhop in C minor.", latestPattern: 's("bd sd")' },
      14,
      messages,
    );
    expect(window).toEqual([
      {
        role: "user",
        content:
          `${SUMMARY_CONTEXT_PREFIX}\nLo-fi jazzhop in C minor.\n\n` +
          'Current pattern:\n```strudel\ns("bd sd")\n```',
      },
      ...messages.slice(14),
    ]);
  });

  it("omits the pattern section when the artifact has none", () => {
    const messages = conversation(2);
    const window = buildContextWindow(
      { summary: "Just talk so far.", latestPattern: "" },
      1,
      messages,
    );
    expect(window[0]).toEqual({
      role: "user",
      content: `${SUMMARY_CONTEXT_PREFIX}\nJust talk so far.`,
    });
    expect(window).toHaveLength(2);
    expect(window[0]?.content).not.toContain("Current pattern:");
  });

  it("sends the full uncovered tail uncapped", () => {
    const messages = conversation(30);
    const window = buildContextWindow(
      { summary: "A stale summary.", latestPattern: "" },
      2,
      messages,
    );
    expect(window).toHaveLength(29);
    expect(window.slice(1)).toEqual(messages.slice(2));
  });

  it("sends only the artifact right after a full fold", () => {
    const messages = conversation(14);
    const window = buildContextWindow(
      { summary: "Covers it all.", latestPattern: 's("hh*8")' },
      14,
      messages,
    );
    expect(window).toHaveLength(1);
    expect(window[0]?.role).toBe("user");
    expect(window[0]?.content).toContain('s("hh*8")');
  });

  it("handles an empty history", () => {
    expect(buildContextWindow(null, 0, [])).toEqual([]);
    expect(
      buildContextWindow(
        { summary: "Something earlier.", latestPattern: "" },
        0,
        [],
      ),
    ).toEqual([
      {
        role: "user",
        content: `${SUMMARY_CONTEXT_PREFIX}\nSomething earlier.`,
      },
    ]);
  });
});

describe("parseCompactionSummary", () => {
  it("accepts a trimmed summary and pattern pair", () => {
    expect(
      parseCompactionSummary(
        '{"summary":"  House at 126 BPM.  ","latestPattern":" s(\\"bd*4\\") "}',
      ),
    ).toEqual({ summary: "House at 126 BPM.", latestPattern: 's("bd*4")' });
  });

  it("accepts an empty pattern", () => {
    expect(
      parseCompactionSummary('{"summary":"Just talk.","latestPattern":""}'),
    ).toEqual({ summary: "Just talk.", latestPattern: "" });
  });

  it("unwraps a pattern the model fenced anyway", () => {
    expect(
      parseCompactionSummary(
        '{"summary":"Techno.","latestPattern":"```strudel\\ns(\\"bd\\")\\n```"}',
      ),
    ).toEqual({ summary: "Techno.", latestPattern: 's("bd")' });
  });

  it("rejects malformed payloads", () => {
    expect(parseCompactionSummary("not json")).toBeNull();
    expect(parseCompactionSummary('{"summary":"x"}')).toBeNull();
    expect(
      parseCompactionSummary('{"summary":42,"latestPattern":""}'),
    ).toBeNull();
    expect(
      parseCompactionSummary('{"summary":"x","latestPattern":7}'),
    ).toBeNull();
    expect(
      parseCompactionSummary(
        '{"summary":"x","latestPattern":"","extra":"y"}',
      ),
    ).toBeNull();
    expect(
      parseCompactionSummary('{"summary":"   ","latestPattern":""}'),
    ).toBeNull();
    expect(
      parseCompactionSummary(
        '{"summary":"```js code```","latestPattern":""}',
      ),
    ).toBeNull();
    expect(
      parseCompactionSummary(
        '{"summary":"Techno.","latestPattern":"``` broken"}',
      ),
    ).toBeNull();
    expect(
      parseCompactionSummary(JSON.stringify({
        summary: "Too large.",
        latestPattern: "x".repeat(30_001),
      })),
    ).toBeNull();
  });
});

describe("createFoldScheduler", () => {
  const ARTIFACT = { summary: "A techno session.", latestPattern: 's("bd*4")' };

  function harness(overrides: {
    summarize?: Parameters<typeof createFoldScheduler<ChatMessage>>[0]["summarize"];
    onFoldFailed?: (error: string) => void;
  } = {}) {
    let live: FoldSnapshot<ChatMessage> = {
      messages: conversation(4),
      artifact: null,
      coveredCount: 0,
      promptTokens: OVER_BUDGET,
    };
    const summarize = vi.fn(
      overrides.summarize ??
        (async () => ({ ok: true as const, artifact: ARTIFACT })),
    );
    const scheduler = createFoldScheduler<ChatMessage>({
      summarize,
      isSameMessage: (a, b) => a === b,
      commit: (accept) => {
        const next = accept(live);
        if (next) live = { ...live, ...next };
      },
      onFoldFailed: overrides.onFoldFailed,
    });
    return {
      scheduler,
      summarize,
      get live() {
        return live;
      },
      set live(value: FoldSnapshot<ChatMessage>) {
        live = value;
      },
    };
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function deferredHarness() {
    let finish: (result: CompactionSummaryResult) => void = () => {};
    const h = harness({
      summarize: () => new Promise((resolve) => { finish = resolve; }),
    });
    return { h, finish: (result: CompactionSummaryResult) => finish(result) };
  }

  it("folds a due conversation and commits against the live state", async () => {
    const h = harness();
    h.scheduler.maybeFold(h.live);
    await settle();

    expect(h.summarize).toHaveBeenCalledExactlyOnceWith(
      null,
      h.live.messages.slice(0, 4),
    );
    expect(h.live.artifact).toEqual(ARTIFACT);
    expect(h.live.coveredCount).toBe(4);
  });

  it("does not fold below the token budget or before a count exists", () => {
    const h = harness();
    h.scheduler.maybeFold({ ...h.live, promptTokens: COMPACTION_TRIGGER_TOKENS });
    h.scheduler.maybeFold({ ...h.live, promptTokens: null });
    expect(h.summarize).not.toHaveBeenCalled();
  });

  it("never folds a lone uncovered message on size alone", () => {
    const h = harness();
    h.scheduler.maybeFold({ ...h.live, messages: conversation(1) });
    expect(h.summarize).not.toHaveBeenCalled();
  });

  it("runs at most one summarizer call at a time", async () => {
    const { h, finish } = deferredHarness();
    h.scheduler.maybeFold(h.live);
    h.scheduler.maybeFold(h.live);
    expect(h.summarize).toHaveBeenCalledOnce();
    finish({ ok: true, artifact: ARTIFACT });
    await settle();
    expect(h.live.artifact).toEqual(ARTIFACT);
  });

  it("discards a result when the folded slice is no longer a prefix", async () => {
    const h = harness();
    const folded = h.live;
    h.scheduler.maybeFold(folded);
    // The session was cleared while the summarizer ran.
    h.live = {
      messages: [],
      artifact: null,
      coveredCount: 0,
      promptTokens: null,
    };
    await settle();
    expect(h.live.artifact).toBeNull();
    expect(h.live.coveredCount).toBe(0);
  });

  it("discards an in-flight result after reset", async () => {
    const { h, finish } = deferredHarness();
    h.scheduler.maybeFold(h.live);

    h.scheduler.reset();
    finish({ ok: true, artifact: ARTIFACT });
    await settle();

    expect(h.live.artifact).toBeNull();
    expect(h.live.coveredCount).toBe(0);
  });

  it("stops after MAX_FOLD_FAILURES consecutive failures until reset", async () => {
    const errors: string[] = [];
    const h = harness({
      summarize: async () => ({ ok: false as const, error: "nope" }),
      onFoldFailed: (error) => errors.push(error),
    });
    for (let round = 0; round < MAX_FOLD_FAILURES + 2; round += 1) {
      h.scheduler.maybeFold(h.live);
      await settle();
    }
    expect(h.summarize).toHaveBeenCalledTimes(MAX_FOLD_FAILURES);
    expect(errors).toEqual(["nope", "nope", "nope"]);

    h.scheduler.reset();
    h.scheduler.maybeFold(h.live);
    await settle();
    expect(h.summarize).toHaveBeenCalledTimes(MAX_FOLD_FAILURES + 1);
  });

  it("counts a rejected summarizer call as a failure", async () => {
    const errors: string[] = [];
    const h = harness({
      summarize: async () => {
        throw new Error("network down");
      },
      onFoldFailed: (error) => errors.push(error),
    });
    h.scheduler.maybeFold(h.live);
    await settle();
    expect(errors).toEqual(["network down"]);
    expect(h.live.artifact).toBeNull();
  });
});
