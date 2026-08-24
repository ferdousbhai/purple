const KEY_STORAGE_KEY = 'purple.byok.gemini-key'
export const CHAT_STORAGE_KEY = 'purple.byok.chat'

// One-time adoption of the pre-rebrand keys (the app shipped as Riff through
// 0.3.x), so a returning visitor keeps their key and chat.
try {
  if ('window' in globalThis) {
    for (const [legacy, current] of [
      ['riff.byok.gemini-key', KEY_STORAGE_KEY],
      ['riff.byok.chat', CHAT_STORAGE_KEY],
    ] as const) {
      const value = window.localStorage.getItem(legacy)
      if (value !== null) {
        if (window.localStorage.getItem(current) === null) {
          window.localStorage.setItem(current, value)
        }
        window.localStorage.removeItem(legacy)
      }
    }
  }
} catch {
  // Storage unavailable (private mode); nothing to migrate.
}

export function getByokKey(): string | null {
  try {
    const key = window.localStorage.getItem(KEY_STORAGE_KEY)
    return key && key.trim() ? key.trim() : null
  } catch {
    return null
  }
}

export function setByokKey(key: string | null): void {
  try {
    if (key && key.trim()) window.localStorage.setItem(KEY_STORAGE_KEY, key.trim())
    else window.localStorage.removeItem(KEY_STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode); the key simply won't persist.
  }
}

export function clearByokChat(): boolean {
  try {
    window.localStorage.removeItem(CHAT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
