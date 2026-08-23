/**
 * Saved patterns, persisted as a plain JSON array in localStorage. The studio
 * reads them through `usePatterns`; cross-tab edits arrive via the `storage`
 * event. No server ever sees them.
 */
import { useSyncExternalStore } from 'react'
import { z } from 'zod'

const patternSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(60),
  code: z.string().min(1).max(30_000),
  prompt: z.string().max(4_000).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type SavedPattern = z.infer<typeof patternSchema>

const STORAGE_KEY = 'purple.patterns.v1'
const LEGACY_KEY = 'riff.patterns.v1'

/** The per-entry envelope the retired TanStack DB collection wrapped items in. */
const tanstackEntrySchema = z.object({ versionKey: z.string(), data: z.unknown() })

/**
 * Parse a stored value into patterns, dropping entries that fail the schema.
 * Understands the plain array this module writes and the object map the
 * retired TanStack DB collection wrote (`{ [key]: { versionKey, data } }`).
 */
export function parseStored(raw: string): SavedPattern[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const candidates = Array.isArray(parsed)
    ? parsed
    : Object.values(z.record(z.string(), z.unknown()).catch({}).parse(parsed)).map((value) => {
        const wrapped = tanstackEntrySchema.safeParse(value)
        return wrapped.success ? wrapped.data.data : value
      })
  return candidates.flatMap((candidate) => {
    const result = patternSchema.safeParse(candidate)
    return result.success ? [result.data] : []
  })
}

let cache: SavedPattern[] = []
let loaded = false
const listeners = new Set<() => void>()

function load(): SavedPattern[] {
  try {
    // One-time adoption of the pre-rebrand store (the app shipped as Riff
    // through 0.3.x), so a returning visitor keeps their saved patterns.
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy !== null) {
      if (window.localStorage.getItem(STORAGE_KEY) === null) {
        window.localStorage.setItem(STORAGE_KEY, legacy)
      }
      window.localStorage.removeItem(LEGACY_KEY)
    }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? [] : parseStored(raw)
  } catch {
    // Storage unavailable (private mode); patterns live only in this tab.
    return []
  }
}

function snapshot(): SavedPattern[] {
  if (!loaded) {
    cache = load()
    loaded = true
  }
  return cache
}

function commit(next: SavedPattern[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Do not update the in-memory view when persistence failed. Otherwise the
    // UI would claim a pattern was saved even though a reload would lose it.
    return false
  }
  cache = next
  loaded = true
  listeners.forEach((listener) => listener())
  return true
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    loaded = false
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Insert or replace a pattern by id. Throws if it violates the schema bounds. */
export function upsertPattern(pattern: SavedPattern): boolean {
  const valid = patternSchema.parse(pattern)
  return commit([...snapshot().filter(({ id }) => id !== valid.id), valid])
}

export function removePattern(id: string): boolean {
  return commit(snapshot().filter((pattern) => pattern.id !== id))
}

/** Keep a colliding title recognizable without overwriting another pattern. */
export function uniquePatternTitle(
  requestedTitle: string,
  patterns: readonly Pick<SavedPattern, 'title'>[],
): string {
  const titles = new Set(patterns.map(({ title }) => title))
  if (!titles.has(requestedTitle)) return requestedTitle

  for (let copy = 2; ; copy++) {
    const suffix = ` (${copy})`
    const base = requestedTitle.slice(0, 60 - suffix.length).trimEnd()
    const candidate = `${base}${suffix}`
    if (!titles.has(candidate)) return candidate
  }
}

export function usePatterns(): SavedPattern[] {
  return useSyncExternalStore(subscribe, snapshot)
}
