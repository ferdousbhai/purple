/**
 * Purple once kept a Gemini API key and a chat transcript in localStorage
 * (the "bring your own key" era). The agent-driven studio never reads them,
 * so every load removes what an old version left behind.
 */
const LEGACY_PREFIX = 'purple.byok.'

export function purgeLegacyStorage(storage: Pick<Storage, 'key' | 'length' | 'removeItem'>): void {
  const stale: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(LEGACY_PREFIX)) stale.push(key)
  }
  for (const key of stale) storage.removeItem(key)
}

export function purgeLegacyLocalStorage(): void {
  try {
    purgeLegacyStorage(localStorage)
  } catch {
    // Blocked storage has nothing of ours to clean.
  }
}
