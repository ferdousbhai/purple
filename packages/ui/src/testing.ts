/** Test-only helpers shared by the package and app suites. */

type StorageSubset = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface LocalStorageStub {
  values: Map<string, string>;
  /** Stub target: `vi.stubGlobal("window", stub.window)`. */
  window: { localStorage: StorageSubset };
}

export function localStorageStub(
  entries: readonly [string, string][] = [],
): LocalStorageStub {
  const values = new Map(entries);
  return {
    values,
    window: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => {
          values.delete(key);
        },
      },
    },
  };
}

/** Every access throws, as in a browser that blocks site data. */
export function blockedLocalStorageStub(): LocalStorageStub["window"] {
  const blocked = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  return {
    localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked },
  };
}
