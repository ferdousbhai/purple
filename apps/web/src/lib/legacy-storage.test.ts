import { describe, expect, it } from 'vitest'
import { purgeLegacyStorage } from './legacy-storage'

function storageOf(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries))
  return {
    values,
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

describe('purgeLegacyStorage', () => {
  it('removes the Gemini-era keys and nothing else', () => {
    const storage = storageOf({
      'purple.byok.gemini-key': 'AIza...',
      'purple.byok.chat': '{"messages":[]}',
      'purple.patterns.v1': '[]',
      'purple.session-pattern.v1': '{}',
      'purple-agent-link': '{}',
    })
    purgeLegacyStorage(storage)
    expect([...storage.values.keys()]).toEqual([
      'purple.patterns.v1',
      'purple.session-pattern.v1',
      'purple-agent-link',
    ])
  })
})
