import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db'
import { z } from 'zod'

const patternSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(60),
  code: z.string().min(1).max(30_000),
  prompt: z.string().max(4_000).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

type SavedPattern = z.infer<typeof patternSchema>

/** Browser-only globals are absent under SSR on Workers, so resolve the capability once. */
const hasWindow = 'window' in globalThis

let collection: ReturnType<typeof createPatternsCollection> | undefined

export function getPatternsCollection() {
  // localStorage-backed; the Worker render pass must never construct it.
  if (!hasWindow) {
    throw new Error('Patterns collection is only available in the browser.')
  }
  collection ??= createPatternsCollection()
  return collection
}

function createPatternsCollection() {
  // One-time adoption of the pre-rebrand store (the app shipped as Riff
  // through 0.3.x), so a returning visitor keeps their saved patterns.
  try {
    const legacy = window.localStorage.getItem('riff.patterns.v1')
    if (legacy !== null) {
      if (window.localStorage.getItem('purple.patterns.v1') === null) {
        window.localStorage.setItem('purple.patterns.v1', legacy)
      }
      window.localStorage.removeItem('riff.patterns.v1')
    }
  } catch {
    // Storage unavailable (private mode); nothing to migrate.
  }
  return createCollection(
    localStorageCollectionOptions({
      id: 'purple-patterns',
      storageKey: 'purple.patterns.v1',
      getKey: (pattern: SavedPattern) => pattern.id,
      schema: patternSchema,
    }),
  )
}
