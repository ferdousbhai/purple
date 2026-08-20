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
  return createCollection(
    localStorageCollectionOptions({
      id: 'riff-patterns',
      storageKey: 'riff.patterns.v1',
      getKey: (pattern: SavedPattern) => pattern.id,
      schema: patternSchema,
    }),
  )
}
