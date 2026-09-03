import { afterEach, describe, expect, it, vi } from "vitest";
import { createPatternStore } from "./session-store";
import { blockedLocalStorageStub, localStorageStub } from "./testing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function flushPatternSave(): void {
  vi.advanceTimersByTime(300);
}

function stubStorage(): Map<string, string> {
  const stub = localStorageStub();
  vi.stubGlobal("window", stub.window);
  return stub.values;
}

function stubBlockedStorage(): void {
  vi.stubGlobal("window", blockedLocalStorageStub());
}

describe("session pattern storage", () => {
  const pattern = {
    code: 's("bd*4").gain(0.8)',
    customTitle: "Warehouse",
  };

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

  it("stays inert when storage is blocked", () => {
    vi.useFakeTimers();
    stubBlockedStorage();
    const store = createPatternStore();

    store.save(pattern);
    expect(() => flushPatternSave()).not.toThrow();
    expect(store.load()).toBeNull();
  });
});
