import { describe, expect, it } from 'vitest'
import { parseStored } from './patterns'

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
