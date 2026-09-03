/**
 * Saved patterns, persisted as a plain JSON array in localStorage. The studio
 * reads them through `usePatterns`; cross-tab edits arrive via the `storage`
 * event. Library entries stay in this browser, including local copies of
 * patterns that were deliberately published through the share service.
 */
import { useSyncExternalStore } from 'react'
import { MAX_PATTERN_LENGTH } from '@purple/core/pattern'
import { isShareId } from '@purple/core/shared-pattern'
import {
  isJsonNumber,
  isJsonString,
  jsonMembers,
  type JsonValue,
} from '@purple/core/json'
import { createPatternStore } from '@purple/ui/session-store'

export interface SavedPattern {
  id: string
  title: string
  code: string
  shareId?: string
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'purple.patterns.v1'
const LEGACY_KEY = 'riff.patterns.v1'

/**
 * Parse a stored value into patterns, dropping entries that fail the schema.
 * Understands the plain array this module writes and the object map the
 * retired TanStack DB collection wrote (`{ [key]: { versionKey, data } }`).
 */
export function parseStored(raw: string): SavedPattern[] {
  let parsed: JsonValue
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const members = jsonMembers(parsed)
  const candidates = Array.isArray(parsed)
    ? parsed
    : members
      ? [...members.values()].map(unwrapLegacyEntry)
      : []
  return candidates.flatMap((candidate) => {
    const result = parsePattern(candidate)
    return result ? [result] : []
  })
}

function unwrapLegacyEntry(value: JsonValue): JsonValue {
  const fields = jsonMembers(value)
  const data = fields?.get('data')
  return isJsonString(fields?.get('versionKey')) && data !== undefined
    ? data
    : value
}

function parsePattern(value: JsonValue): SavedPattern | null {
  const fields = jsonMembers(value)
  const id = fields?.get('id')
  const title = fields?.get('title')
  const code = fields?.get('code')
  const shareId = fields?.get('shareId')
  const createdAt = fields?.get('createdAt')
  const updatedAt = fields?.get('updatedAt')
  if (
    !isJsonString(id) ||
    !isJsonString(title) ||
    title.length === 0 ||
    title.length > 60 ||
    !isJsonString(code) ||
    code.length === 0 ||
    code.length > MAX_PATTERN_LENGTH ||
    (shareId !== undefined && (!isJsonString(shareId) || !isShareId(shareId))) ||
    !isJsonNumber(createdAt) ||
    !isJsonNumber(updatedAt)
  ) {
    return null
  }
  const pattern: SavedPattern = {
    id,
    title,
    code,
    createdAt,
    updatedAt,
  }
  if (isJsonString(shareId)) pattern.shareId = shareId
  return pattern
}

function normalizePattern(pattern: SavedPattern): SavedPattern | null {
  if (
    pattern.title.length === 0 ||
    pattern.title.length > 60 ||
    pattern.code.length === 0 ||
    pattern.code.length > MAX_PATTERN_LENGTH ||
    (pattern.shareId !== undefined && !isShareId(pattern.shareId)) ||
    !Number.isFinite(pattern.createdAt) ||
    !Number.isFinite(pattern.updatedAt)
  ) {
    return null
  }
  const normalized: SavedPattern = {
    id: pattern.id,
    title: pattern.title,
    code: pattern.code,
    createdAt: pattern.createdAt,
    updatedAt: pattern.updatedAt,
  }
  if (pattern.shareId !== undefined) normalized.shareId = pattern.shareId
  return normalized
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

export function upsertPattern(pattern: SavedPattern): boolean {
  const valid = normalizePattern(pattern)
  if (!valid) throw new TypeError('Pattern is outside the saved-library bounds.')
  return commit([...snapshot().filter(({ id }) => id !== valid.id), valid])
}

export function removePattern(id: string): boolean {
  return commit(snapshot().filter((pattern) => pattern.id !== id))
}

export function sharedLibraryId(shareId: string): string {
  if (!isShareId(shareId)) throw new TypeError('Invalid shared pattern id.')
  return `shared:${shareId}`
}

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

/**
 * The pattern the visitor was last working on, so a reload restores the
 * session instead of resetting to a starter. Validation and bounds live in
 * the shared store.
 */
const sessionPatternStore = createPatternStore()

export const loadSessionPattern = sessionPatternStore.load
export const saveSessionPattern = sessionPatternStore.save
