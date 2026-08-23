import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseStored, uniquePatternTitle } from './patterns'
import { localStorageStub } from '@purple/ui/testing'

const pattern = {
  id: 'a',
  title: 'Late night',
  code: 's("bd sd")',
  createdAt: 1,
  updatedAt: 2,
}

describe('parseStored', () => {
  it('reads the plain array this module writes', () => {
    expect(parseStored(JSON.stringify([pattern]))).toEqual([pattern])
  })

  it('reads the object map the retired TanStack DB collection wrote', () => {
    const stored = { '"a"': { versionKey: 'uuid-1', data: pattern } }
    expect(parseStored(JSON.stringify(stored))).toEqual([pattern])
  })

  it('drops entries that fail the schema and keeps the rest', () => {
    const invalid = { ...pattern, id: 'b', title: '' }
    expect(parseStored(JSON.stringify([pattern, invalid]))).toEqual([pattern])
  })

  it('returns nothing for corrupt JSON or unexpected shapes', () => {
    expect(parseStored('not json')).toEqual([])
    expect(parseStored('42')).toEqual([])
    expect(parseStored('null')).toEqual([])
  })
})

describe('uniquePatternTitle', () => {
  it('keeps an unused title and numbers colliding copies', () => {
    expect(uniquePatternTitle('Late night', [])).toBe('Late night')
    expect(
      uniquePatternTitle('Late night', [
        { title: 'Late night' },
        { title: 'Late night (2)' },
      ]),
    ).toBe('Late night (3)')
  })

  it('keeps numbered titles within the persisted title bound', () => {
    const title = 'x'.repeat(60)
    const copy = uniquePatternTitle(title, [{ title }])
    expect(copy).toHaveLength(60)
    expect(copy.endsWith(' (2)')).toBe(true)
  })
})

describe('pattern persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('reports a successful durable save', async () => {
    const { values, window } = localStorageStub()
    vi.stubGlobal('window', window)
    const { upsertPattern } = await import('./patterns')

    expect(upsertPattern(pattern)).toBe(true)
    expect([...values.values()].some((raw) => raw.includes('Late night'))).toBe(true)
  })

  it('reports a blocked save instead of updating only memory', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('blocked', 'QuotaExceededError')
        },
        removeItem: () => undefined,
      },
    })
    const { upsertPattern } = await import('./patterns')

    expect(upsertPattern(pattern)).toBe(false)
  })
})
