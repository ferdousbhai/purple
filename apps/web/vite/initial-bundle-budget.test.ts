import { describe, expect, it } from 'vitest'
import { measureInitialJavaScript, type BundleChunkInput } from './initial-bundle-budget'

function chunk(
  fileName: string,
  options: Partial<BundleChunkInput> = {},
): BundleChunkInput {
  return {
    code: 'export{}',
    fileName,
    imports: [],
    isEntry: false,
    modules: {},
    ...options,
  }
}

describe('measureInitialJavaScript', () => {
  it('includes static imports but excludes lazy chunks', () => {
    const report = measureInitialJavaScript([
      chunk('entry.js', {
        code: 'import"./vendor.js"',
        imports: ['vendor.js'],
        isEntry: true,
        modules: { '/project/src/main.tsx': { renderedLength: 50 } },
      }),
      chunk('vendor.js', {
        code: 'export const react=1',
        modules: { '/project/node_modules/react/index.js': { renderedLength: 500 } },
      }),
      chunk('editor.js', {
        code: 'export const editor=1',
        modules: { '/project/node_modules/editor/index.js': { renderedLength: 5_000 } },
      }),
    ])

    expect(report.initialFiles).toEqual(['entry.js', 'vendor.js'])
    expect(report.minifiedBytes).toBe(39)
    expect(report.gzipBytes).toBeGreaterThan(0)
    expect(report.largestModules[0]).toMatchObject({ renderedBytes: 500 })
  })

  it('walks nested static imports once across multiple entries', () => {
    const report = measureInitialJavaScript([
      chunk('first.js', {
        code: 'import"./shared.js"',
        imports: ['shared.js'],
        isEntry: true,
      }),
      chunk('second.js', {
        code: 'import"./shared.js"',
        imports: ['shared.js'],
        isEntry: true,
      }),
      chunk('shared.js', {
        code: 'import"./nested.js"',
        imports: ['nested.js'],
      }),
      chunk('nested.js', { code: 'export const nested=1' }),
    ])

    expect(report.initialFiles).toEqual([
      'first.js',
      'nested.js',
      'second.js',
      'shared.js',
    ])
    expect(report.minifiedBytes).toBe(78)
  })
})
