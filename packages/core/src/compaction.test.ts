import { describe, expect, it } from "vitest";
import {
  buildCompactionRequest,
  buildContextWindow,
  COMPACTION_TRIGGER,
  parseCompactionSummary,
  planCompaction,
  SUMMARY_CONTEXT_PREFIX,
} from "./compaction";
import { MAX_CONTEXT_MESSAGES, type ChatMessage } from "./types";

function conversation(length: number): ChatMessage[] {
  return Array.from({ length }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message ${index}`,
  }));
}

describe("planCompaction", () => {
  it("does not fold at or below the trigger", () => {
    expect(planCompaction(0, 0)).toEqual({ fold: false, foldEnd: 0 });
    expect(planCompaction(COMPACTION_TRIGGER, 0)).toEqual({
      fold: false,
      foldEnd: 0,
    });
  });

  it("folds the entire conversation once the trigger is exceeded", () => {
    expect(planCompaction(COMPACTION_TRIGGER + 1, 0)).toEqual({
      fold: true,
      foldEnd: COMPACTION_TRIGGER + 1,
    });
  });

  it("counts only uncovered messages against the trigger", () => {
    expect(planCompaction(21, 8)).toEqual({ fold: false, foldEnd: 8 });
    expect(planCompaction(22, 8)).toEqual({ fold: true, foldEnd: 22 });
  });

  it("echoes the covered count when no fold is due", () => {
    expect(planCompaction(10, 4)).toEqual({ fold: false, foldEnd: 4 });
  });

  it("clamps an out-of-range covered count", () => {
    expect(planCompaction(5, 10)).toEqual({ fold: false, foldEnd: 5 });
    expect(planCompaction(5, -3)).toEqual({ fold: false, foldEnd: 0 });
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
  it("matches the legacy trim when no artifact exists", () => {
    const messages = conversation(20);
    expect(buildContextWindow(null, 0, messages)).toEqual(
      messages.slice(-MAX_CONTEXT_MESSAGES),
    );
  });

  it("sends a short history whole when no artifact exists", () => {
    const messages = conversation(3);
    expect(buildContextWindow(null, 0, messages)).toEqual(messages);
  });

  it("treats a blank summary as no artifact", () => {
    const messages = conversation(20);
    expect(
      buildContextWindow({ summary: "  ", latestPattern: "x" }, 5, messages),
    ).toEqual(messages.slice(-MAX_CONTEXT_MESSAGES));
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

  it("caps a stale uncovered tail at MAX_CONTEXT_MESSAGES", () => {
    const messages = conversation(30);
    const window = buildContextWindow(
      { summary: "A stale summary.", latestPattern: "" },
      2,
      messages,
    );
    expect(window).toHaveLength(MAX_CONTEXT_MESSAGES + 1);
    expect(window.slice(1)).toEqual(messages.slice(-MAX_CONTEXT_MESSAGES));
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
    expect(
      parseCompactionSummary(
        '{"summary":"Techno.","latestPattern":"``` broken"}',
      ),
    ).toEqual({ summary: "Techno.", latestPattern: "" });
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
  });
});
