const CHUNK_RELOAD_KEY = 'purple:chunk-reload'
const CHUNK_RELOAD_COOLDOWN_MS = 60_000

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Reload once when an open tab references a lazy chunk removed by a newer deploy.
 * A cooldown keeps a persistent network or hosting failure from causing a loop.
 */
export function recoverFromPreloadError(
  event: Event,
  getStorage: () => ReloadStorage,
  reload: () => void,
  now = Date.now(),
): boolean {
  try {
    const storage = getStorage()
    const lastReload = Number(storage.getItem(CHUNK_RELOAD_KEY))
    if (
      Number.isFinite(lastReload) &&
      lastReload > 0 &&
      now - lastReload < CHUNK_RELOAD_COOLDOWN_MS
    ) {
      return false
    }
    storage.setItem(CHUNK_RELOAD_KEY, String(now))
  } catch {
    // Without session storage there is no safe way to prevent a reload loop.
    return false
  }

  event.preventDefault()
  reload()
  return true
}

export function installChunkReloadRecovery(target: Window = window): () => void {
  const handlePreloadError = (event: Event) => {
    recoverFromPreloadError(
      event,
      () => target.sessionStorage,
      () => target.location.reload(),
    )
  }
  target.addEventListener('vite:preloadError', handlePreloadError)
  return () => target.removeEventListener('vite:preloadError', handlePreloadError)
}
