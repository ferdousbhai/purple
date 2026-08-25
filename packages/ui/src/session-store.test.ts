import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChatStore,
  createPatternStore,
  parseChatEnvelope,
  toChatEnvelope,
} from "./session-store";
import { blockedLocalStorageStub, localStorageStub } from "./testing";
import type { StudioChatState } from "./use-studio-chat";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The pattern store debounces writes; run the trailing save now. */
function flushPatternSave(): void {
  vi.advanceTimersByTime(300);
}

function chat(overrides: Partial<StudioChatState> = {}): StudioChatState {
  return {
    messages: [
      { role: "user", content: "four on the floor" },
      { role: "assistant", content: '```strudel\ns("bd*4")\n```' },
    ],
    artifact: { summary: "A techno session.", latestPattern: 's("bd*4")' },
    coveredCount: 2,
    ...overrides,
  };
}

function stubStorage(): Map<string, string> {
  const stub = localStorageStub();
  vi.stubGlobal("window", stub.window);
  return stub.values;
}

function stubBlockedStorage(): void {
  vi.stubGlobal("window", blockedLocalStorageStub());
}

describe("chat persistence envelope", () => {
  it("round-trips a chat through the stored envelope", () => {
    const state = chat();
    expect(parseChatEnvelope(JSON.stringify(toChatEnvelope(state)))).toEqual(state);
  });

  it("round-trips the pre-first-fold shape (no artifact)", () => {
    const state = chat({ artifact: null, coveredCount: 0 });
    expect(parseChatEnvelope(JSON.stringify(toChatEnvelope(state)))).toEqual(state);
  });

  it("discards malformed JSON silently", () => {
    expect(parseChatEnvelope("{not json")).toBeNull();
  });

  it("discards an envelope from another version", () => {
    const raw = JSON.stringify({ ...toChatEnvelope(chat()), v: 3 });
    expect(parseChatEnvelope(raw)).toBeNull();
  });

  it("migrates a v1 envelope, mapping text onto content", () => {
    const raw = JSON.stringify({
      v: 1,
      messages: [
        { role: "user", text: "four on the floor" },
        { role: "assistant", text: 's("bd*4")' },
      ],
      artifact: { summary: "A techno session.", latestPattern: 's("bd*4")' },
      coveredCount: 5,
    });
    expect(parseChatEnvelope(raw)).toEqual({
      messages: [
        { role: "user", content: "four on the floor" },
        { role: "assistant", content: 's("bd*4")' },
      ],
      artifact: { summary: "A techno session.", latestPattern: 's("bd*4")' },
      coveredCount: 2,
    });
  });

  it("discards an envelope whose fields do not match the schema", () => {
    expect(parseChatEnvelope(JSON.stringify({ v: 2, messages: "nope" }))).toBeNull();
    expect(
      parseChatEnvelope(
        JSON.stringify({
          v: 1,
          messages: [{ role: "system", content: "x" }],
          artifact: null,
          coveredCount: 0,
        }),
      ),
    ).toBeNull();
    expect(
      parseChatEnvelope(
        JSON.stringify({ v: 2, messages: [], artifact: null, coveredCount: -1 }),
      ),
    ).toBeNull();
  });

  it("clamps a stored coveredCount that exceeds the stored messages", () => {
    const raw = JSON.stringify({
      v: 2,
      messages: [{ role: "user", content: "hi" }],
      artifact: { summary: "s", latestPattern: "" },
      coveredCount: 5,
    });
    expect(parseChatEnvelope(raw)?.coveredCount).toBe(1);
  });

  it("caps the stored transcript and shifts coveredCount by the dropped prefix", () => {
    const messages = Array.from({ length: 250 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index}`,
    }));
    const envelope = toChatEnvelope(chat({ messages, coveredCount: 240 }));
    expect(envelope.messages).toHaveLength(200);
    expect(envelope.messages[0]?.content).toBe("message 50");
    // 50 covered messages fell off the front; the artifact still summarizes them.
    expect(envelope.coveredCount).toBe(190);
  });

  it("retains uncovered messages even when they exceed the persistence target", () => {
    const messages = Array.from({ length: 250 }, () => ({
      role: "user" as const,
      content: "x",
    }));
    const envelope = toChatEnvelope(chat({ messages, coveredCount: 10 }));
    expect(envelope.messages).toHaveLength(240);
    expect(envelope.messages[0]?.content).toBe("x");
    expect(envelope.coveredCount).toBe(0);
  });

  it("does not drop messages when there is no usable artifact", () => {
    const messages = Array.from({ length: 250 }, (_, index) => ({
      role: "user" as const,
      content: `message ${index}`,
    }));
    const envelope = toChatEnvelope(
      chat({ messages, artifact: null, coveredCount: 240 }),
    );
    expect(envelope.messages).toEqual(messages);
    expect(envelope.coveredCount).toBe(0);
  });

  it("clamps an out-of-range live coveredCount when storing", () => {
    expect(toChatEnvelope(chat({ coveredCount: 99 })).coveredCount).toBe(2);
    expect(toChatEnvelope(chat({ coveredCount: -3 })).coveredCount).toBe(0);
  });
});

describe("chat storage", () => {
  it("round-trips a chat and clears it", () => {
    stubStorage();
    const store = createChatStore();

    expect(store.load()).toBeNull();
    expect(store.save(chat())).toBe(true);
    expect(store.load()).toEqual(chat());
    expect(store.clear()).toBe(true);
    expect(store.load()).toBeNull();
  });

  it("keeps stores with different keys independent", () => {
    stubStorage();
    const store = createChatStore();
    const scoped = createChatStore("purple.byok.chat");

    store.save(chat());
    expect(scoped.load()).toBeNull();
  });

  it("reports blocked writes and clears to the caller", () => {
    stubBlockedStorage();
    const store = createChatStore();

    expect(store.save(chat())).toBe(false);
    expect(store.clear()).toBe(false);
    expect(store.load()).toBeNull();
  });
});

describe("session pattern storage", () => {
  const pattern = {
    code: 's("bd*4").gain(0.8)',
    customTitle: "Warehouse",
    sourcePrompt: "a warehouse techno beat",
  };

  /** Fake timers, stubbed storage, and a store already holding `pattern`. */
  function storeWithSavedPattern() {
    vi.useFakeTimers();
    const values = stubStorage();
    const store = createPatternStore();
    store.save(pattern);
    flushPatternSave();
    return { store, values };
  }

  it("round-trips the working pattern after the debounce settles", () => {
    vi.useFakeTimers();
    const values = stubStorage();
    const store = createPatternStore();

    expect(store.load()).toBeNull();
    store.save(pattern);
    expect(values.size).toBe(0);
    flushPatternSave();
    expect(store.load()).toEqual(pattern);
  });

  it("loads the newest normalized pattern before its debounce settles", () => {
    const { store } = storeWithSavedPattern();
    const edited = { ...pattern, code: 's("bd sd")' };

    store.save(edited);
    const restored = store.load();
    expect(restored).toEqual(edited);

    // A client-side route remount saves the value it just restored. That must
    // not cancel the pending edit and resurrect the older stored pattern.
    expect(restored).not.toBeNull();
    if (restored) store.save(restored);
    flushPatternSave();
    expect(store.load()).toEqual(edited);
  });

  it("round-trips a valid public share reference", () => {
    vi.useFakeTimers();
    stubStorage();
    const store = createPatternStore();
    const shared = { ...pattern, shareId: "Abc_123-xYz9" };

    store.save(shared);
    flushPatternSave();
    expect(store.load()).toEqual(shared);
  });

  it("does not save a malformed public share reference", () => {
    vi.useFakeTimers();
    const values = stubStorage();
    const store = createPatternStore();

    store.save({ ...pattern, shareId: "short" });
    flushPatternSave();
    expect(values.size).toBe(0);
  });

  it("coalesces rapid saves into the last write", () => {
    vi.useFakeTimers();
    const values = stubStorage();
    const store = createPatternStore();

    store.save({ ...pattern, code: 's("bd")' });
    store.save(pattern);
    flushPatternSave();
    expect(values.size).toBe(1);
    expect(store.load()).toEqual(pattern);
  });

  it("forgets the stored pattern when the editor is emptied", () => {
    const { store, values } = storeWithSavedPattern();

    store.save({ ...pattern, code: "  " });
    expect(store.load()).toBeNull();
    flushPatternSave();
    expect(values.size).toBe(0);
  });

  it("keeps the last good copy over out-of-bounds code and survives corrupt data", () => {
    const { store, values } = storeWithSavedPattern();

    store.save({ ...pattern, code: "x".repeat(30_001) });
    flushPatternSave();
    expect(store.load()).toEqual(pattern);

    values.set("purple.session-pattern.v1", "not json");
    expect(store.load()).toBeNull();
  });

  it("clamps an over-long title instead of dropping the pattern", () => {
    vi.useFakeTimers();
    stubStorage();
    const store = createPatternStore();

    store.save({ ...pattern, customTitle: "t".repeat(80) });
    flushPatternSave();
    expect(store.load()?.customTitle).toBe("t".repeat(60));
  });

  it("clamps an over-long source prompt and drops unknown fields", () => {
    vi.useFakeTimers();
    const values = stubStorage();
    const store = createPatternStore();

    store.save({ ...pattern, sourcePrompt: "p".repeat(4_100) });
    flushPatternSave();
    const stored = JSON.parse(values.get("purple.session-pattern.v1") ?? "null");
    expect(stored.sourcePrompt).toBe("p".repeat(4_000));
    expect(store.load()?.sourcePrompt).toBe("p".repeat(4_000));
  });

  it("stays inert when storage is blocked", () => {
    vi.useFakeTimers();
    stubBlockedStorage();
    const store = createPatternStore();

    store.save(pattern);
    expect(() => flushPatternSave()).not.toThrow();
    expect(store.load()).toBeNull();
  });
});
