import { describe, expect, it } from 'vitest'
import {
  addImmutableAssetHeaders,
  addRouteResourceHints,
  type HostedChunkInput,
  inlineHostedStylesheet,
} from './hosted-page-hints'

const BUILT_HTML = [
  '<!doctype html><html><head><title>Purple</title>',
  '<script type="module" crossorigin src="/assets/index-Entry123.js"></script>',
  '<link rel="modulepreload" crossorigin href="/assets/shared-pattern-Shared123.js">',
  '<link rel="stylesheet" crossorigin href="/assets/index-B-KBoRnC.css">',
  '</head><body></body></html>',
].join('')

describe('hosted page hints', () => {
  it('adds immutable caching only for assets emitted by this build', () => {
    const headers = addImmutableAssetHeaders(
      '/*\n  X-Content-Type-Options: nosniff\n',
      [
        'assets/index-Entry123.js',
        'assets/pattern-editor-BqVqDLu4.js',
        'index.html',
      ],
    )

    expect(headers).toContain(
      '/assets/index-Entry123.js\n  Cache-Control: public, max-age=31536000, immutable',
    )
    expect(headers).toContain('/assets/pattern-editor-BqVqDLu4.js')
    expect(headers).not.toContain('/assets/*')
    expect(headers).not.toContain('/index.html\n  Cache-Control')
  })

  it('rejects a wildcard that would cache missing chunks', () => {
    expect(() => addImmutableAssetHeaders(
      '/assets/*\n  Cache-Control: public, max-age=31536000, immutable',
      ['assets/index-Entry123.js'],
    )).toThrow('must not cache unknown assets')
  })

  it('adds the hashed studio chunks to the built document', () => {
    const html = addRouteResourceHints(
      BUILT_HTML,
      studioChunks(),
    )

    expect(html).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/purple-studio-Dd81xG0W.js" data-purple-studio-preload>',
    )
    expect(html).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/pattern-editor-BqVqDLu4.js" data-purple-studio-preload>',
    )
    expect(html).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/playback-flow-Play123.js" data-purple-studio-preload>',
    )
    expect(html).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/patterns-Patterns123.js" data-purple-studio-preload>',
    )
    expect(html).not.toContain(
      'href="/assets/index-Entry123.js" data-purple-studio-preload',
    )
    expect(html).not.toContain(
      'href="/assets/shared-pattern-Shared123.js" data-purple-studio-preload',
    )
    expect(html).toContain(
      '<template data-purple-patterns-preload="/assets/patterns-Patterns123.js"></template>',
    )
    expect(html).toContain(
      '<template data-purple-patterns-preload="/assets/patterns-page-Page123.js"></template>',
    )
    expect(html.indexOf('data-purple-studio-preload')).toBeLessThan(html.indexOf('</head>'))
  })

  it('inlines the generated stylesheet and identifies the asset to remove', () => {
    const inlined = inlineHostedStylesheet(BUILT_HTML, [{
      fileName: 'assets/index-B-KBoRnC.css',
      source: ':root{color-scheme:dark}',
    }])

    expect(inlined.fileName).toBe('assets/index-B-KBoRnC.css')
    expect(inlined.html).toContain(
      '<style data-purple-hosted-styles>:root{color-scheme:dark}</style>',
    )
    expect(inlined.html).not.toContain('rel="stylesheet"')
  })

  it('normalizes module paths before identifying the editor entry', () => {
    const html = addRouteResourceHints(
      BUILT_HTML,
      [
        chunk('assets/purple-studio-Dd81xG0W.js', '/repo/apps/web/src/components/purple-studio.tsx'),
        chunk('assets/pattern-editor-Abc_123.js', 'C:\\repo\\packages\\ui\\src\\pattern-editor.tsx?source'),
        chunk('assets/patterns-page-Page123.js', '/repo/apps/web/src/components/patterns-page.tsx'),
      ],
    )

    expect(html).toContain('href="/assets/pattern-editor-Abc_123.js"')
  })

  it('fails the build when a hinted asset cannot be identified safely', () => {
    expect(() => addRouteResourceHints(BUILT_HTML, [])).toThrow(
      'Expected one studio chunk, found 0.',
    )
    expect(() => addRouteResourceHints(
      BUILT_HTML,
      [
        chunk('assets/purple-studio-Dd81xG0W.js', '/repo/apps/web/src/components/purple-studio.tsx'),
        chunk('../pattern-editor.js', '/repo/packages/ui/src/pattern-editor.tsx'),
      ],
    )).toThrow('Unexpected pattern editor chunk path')
    expect(() => inlineHostedStylesheet('<head></head>', [])).toThrow(
      'Expected one hosted stylesheet, found 0.',
    )
    expect(() => inlineHostedStylesheet(BUILT_HTML, [])).toThrow(
      'The hosted stylesheet asset is missing',
    )
  })
})

function chunk(fileName: string, moduleId: string): HostedChunkInput {
  return { fileName, imports: [], modules: { [moduleId]: { renderedLength: 1 } } }
}

function studioChunks(): HostedChunkInput[] {
  const studio = chunk(
    'assets/purple-studio-Dd81xG0W.js',
    '/repo/apps/web/src/components/purple-studio.tsx',
  )
  studio.imports = [
    'assets/index-Entry123.js',
    'assets/shared-pattern-Shared123.js',
    'assets/playback-flow-Play123.js',
    'assets/patterns-Patterns123.js',
  ]
  return [
    studio,
    chunk('assets/pattern-editor-BqVqDLu4.js', '/repo/packages/ui/src/pattern-editor.tsx'),
    Object.assign(
      chunk('assets/patterns-page-Page123.js', '/repo/apps/web/src/components/patterns-page.tsx'),
      { imports: ['assets/index-Entry123.js', 'assets/patterns-Patterns123.js'] },
    ),
  ]
}
