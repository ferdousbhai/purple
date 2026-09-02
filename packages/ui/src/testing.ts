type StorageSubset = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface LocalStorageStub {
  values: Map<string, string>;
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

export function blockedLocalStorageStub(): LocalStorageStub["window"] {
  const blocked = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  return {
    localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked },
  };
}
