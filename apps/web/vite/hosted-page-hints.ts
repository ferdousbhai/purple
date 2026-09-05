import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'

const EDITOR_MODULE_SUFFIX = '/packages/ui/src/pattern-editor.tsx'
const PATTERNS_MODULE_SUFFIX = '/apps/web/src/components/patterns-page.tsx'
const STUDIO_MODULE_SUFFIX = '/apps/web/src/components/purple-studio.tsx'
const PRELOAD_MARKER = 'data-purple-studio-preload'
const PATTERNS_PRELOAD_MARKER = 'data-purple-patterns-preload'
const INLINE_STYLE_MARKER = 'data-purple-hosted-styles'
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export interface HostedChunkInput {
  fileName: string
  imports: readonly string[]
  modules: Readonly<Record<string, { renderedLength: number }>>
}

interface HostedStyleInput {
  fileName: string
  source: string | Uint8Array
}

interface InlinedStylesheet {
  fileName: string
  html: string
}

/**
 * Derive browser hints from the final hashed build instead of duplicating
 * filenames in source. Studio chunks stay route-specific at runtime, while the
 * small shared stylesheet is inlined to remove the only render-blocking request.
 */
export function addRouteResourceHints(
  html: string,
  chunks: readonly HostedChunkInput[],
): string {
  if (!html.includes('</head>')) {
    throw new Error('Built index.html is missing its closing head tag.')
  }
  if (html.includes(PRELOAD_MARKER)) {
    throw new Error('Built index.html already contains studio module preloads.')
  }

  const studioChunk = findRouteChunk(
    chunks,
    'studio',
    STUDIO_MODULE_SUFFIX,
    'purple-studio',
  )
  const editorChunk = findRouteChunk(
    chunks,
    'pattern editor',
    EDITOR_MODULE_SUFFIX,
    'pattern-editor',
  )
  const patternsChunk = findRouteChunk(
    chunks,
    'patterns page',
    PATTERNS_MODULE_SUFFIX,
    'patterns-page',
  )
  const existingFiles = referencedScriptFiles(html)
  const studioDependencies = studioChunk.imports.filter(
    (fileName) => !existingFiles.has(fileName),
  )
  const moduleFiles = [...new Set([
    ...studioDependencies,
    studioChunk.fileName,
    editorChunk.fileName,
  ])]
  moduleFiles.forEach(assertScriptAssetPath)
  const preloads = moduleFiles.map(
    (fileName) => `<link rel="modulepreload" crossorigin href="/${fileName}" ${PRELOAD_MARKER}>`,
  )
  const patternsFiles = [...new Set([
    ...patternsChunk.imports.filter((fileName) => !existingFiles.has(fileName)),
    patternsChunk.fileName,
  ])]
  patternsFiles.forEach(assertScriptAssetPath)
  // These inert markers let the Worker activate only the hints appropriate
  // for /patterns without sending gallery JavaScript to studio visitors.
  const patternsHints = patternsFiles.map(
    (fileName) => `<template ${PATTERNS_PRELOAD_MARKER}="/${fileName}"></template>`,
  )
  return html.replace(
    '</head>',
    `    ${[...preloads, ...patternsHints].join('\n    ')}\n  </head>`,
  )
}

export function inlineHostedStylesheet(
  html: string,
  stylesheets: readonly HostedStyleInput[],
): InlinedStylesheet {
  const stylesheetPaths = [...html.matchAll(
    /<link rel="stylesheet" crossorigin href="(\/assets\/[A-Za-z0-9_-]+\.css)">/g,
  )].map((match) => match[1])
  if (stylesheetPaths.length !== 1 || !stylesheetPaths[0]) {
    throw new Error(`Expected one hosted stylesheet, found ${stylesheetPaths.length}.`)
  }
  if (html.includes(INLINE_STYLE_MARKER)) {
    throw new Error('Built index.html already contains hosted inline styles.')
  }

  const fileName = stylesheetPaths[0].slice(1)
  const stylesheet = stylesheets.find((candidate) => candidate.fileName === fileName)
  if (!stylesheet) {
    throw new Error(`The hosted stylesheet asset is missing: ${fileName}.`)
  }

  const link = `<link rel="stylesheet" crossorigin href="/${fileName}">`
  const style = `<style ${INLINE_STYLE_MARKER}>${assetText(stylesheet.source)}</style>`
  return { fileName, html: html.replace(link, style) }
}

/** Cache only files emitted by this build. Unknown old chunks must remain
 * revalidatable so a stale-tab recovery or deployment rollback can retry. */
export function addImmutableAssetHeaders(
  headers: string,
  fileNames: readonly string[],
): string {
  if (/^\/assets\/\*$/m.test(headers)) {
    throw new Error('Hosted headers must not cache unknown assets as immutable.')
  }
  const assets = [...new Set(fileNames.filter(isHashedAssetPath))].sort()
  if (assets.length === 0) {
    throw new Error('The hosted build did not emit any hashed assets.')
  }
  const rules = assets.map(
    (fileName) => `/${fileName}\n  Cache-Control: ${IMMUTABLE_CACHE_CONTROL}`,
  )
  return `${headers.trimEnd()}\n\n${rules.join('\n\n')}\n`
}

export function hostedPageHints(): Plugin {
  return {
    name: 'purple-hosted-page-hints',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') {
        this.error('The hosted build did not produce index.html.')
      }
      const chunks = Object.values(bundle).flatMap((output): HostedChunkInput[] => {
        if (output.type !== 'chunk') return []
        return [{
          fileName: output.fileName,
          imports: output.imports,
          modules: output.modules,
        }]
      })
      const stylesheets = Object.values(bundle).flatMap((output): HostedStyleInput[] => {
        if (output.type !== 'asset' || !output.fileName.endsWith('.css')) return []
        return [{ fileName: output.fileName, source: output.source }]
      })

      try {
        const inlined = inlineHostedStylesheet(assetText(index.source), stylesheets)
        const staleStyleImporters = Object.values(bundle).flatMap((output) =>
          output.type === 'chunk' && output.code.includes(inlined.fileName)
            ? [output.fileName]
            : [],
        )
        if (staleStyleImporters.length > 0) {
          throw new Error(
            `Inlined stylesheet is still referenced by: ${staleStyleImporters.join(', ')}.`,
          )
        }
        index.source = addRouteResourceHints(inlined.html, chunks)
        delete bundle[inlined.fileName]
        const headerTemplate = await readFile(
          new URL('../public/_headers', import.meta.url),
          'utf8',
        )
        this.emitFile({
          type: 'asset',
          fileName: '_headers',
          source: addImmutableAssetHeaders(
            headerTemplate,
            Object.values(bundle).flatMap((output) =>
              output.fileName === inlined.fileName ? [] : [output.fileName],
            ),
          ),
        })
      } catch (error) {
        this.error(error instanceof Error ? error : String(error))
      }
    },
  }
}

function isHashedAssetPath(fileName: string): boolean {
  return /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(fileName)
}

function findRouteChunk(
  chunks: readonly HostedChunkInput[],
  label: string,
  moduleSuffix: string,
  filePrefix: string,
): HostedChunkInput {
  const matches = chunks.filter((chunk) =>
    Object.keys(chunk.modules).some((id) => modulePath(id).endsWith(moduleSuffix)),
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one ${label} chunk, found ${matches.length}.`)
  }

  const chunk = matches[0]
  const fileName = chunk?.fileName
  const expectedPath = new RegExp(`^assets/${filePrefix}-[A-Za-z0-9_-]+\\.js$`)
  if (!fileName || !expectedPath.test(fileName)) {
    throw new Error(`Unexpected ${label} chunk path: ${fileName ?? 'missing'}.`)
  }
  return chunk
}

function referencedScriptFiles(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/(?:href|src)="\/(assets\/[A-Za-z0-9_.-]+\.js)"/g)]
      .flatMap((match) => match[1] ? [match[1]] : []),
  )
}

function assertScriptAssetPath(fileName: string): void {
  if (!/^assets\/[A-Za-z0-9_.-]+\.js$/.test(fileName)) {
    throw new Error(`Unexpected route dependency path: ${fileName}.`)
  }
}

function assetText(source: string | Uint8Array): string {
  return source instanceof Uint8Array ? new TextDecoder().decode(source) : source
}

function modulePath(id: string): string {
  return (id.split('?')[0] ?? id).replaceAll('\\', '/')
}
