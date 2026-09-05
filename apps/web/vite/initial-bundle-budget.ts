import { gzipSync } from 'node:zlib'
import { relative } from 'node:path'
import type { Plugin } from 'vite'

export interface BundleChunkInput {
  code: string
  fileName: string
  imports: readonly string[]
  isEntry: boolean
  modules: Readonly<Record<string, { renderedLength: number }>>
}

interface InitialBundleReport {
  gzipBytes: number
  initialFiles: readonly string[]
  largestModules: readonly { id: string; renderedBytes: number }[]
  minifiedBytes: number
}

export function measureInitialJavaScript(
  chunks: readonly BundleChunkInput[],
): InitialBundleReport {
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const initialFiles = new Set<string>()

  const includeStaticImports = (fileName: string) => {
    if (initialFiles.has(fileName)) return
    const chunk = byFileName.get(fileName)
    if (!chunk) return
    initialFiles.add(fileName)
    chunk.imports.forEach(includeStaticImports)
  }
  chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => includeStaticImports(chunk.fileName))

  const initialChunks = [...initialFiles]
    .map((fileName) => byFileName.get(fileName))
    .filter((chunk): chunk is BundleChunkInput => chunk !== undefined)
  const largestModules = initialChunks
    .flatMap((chunk) =>
      Object.entries(chunk.modules).map(([id, module]) => ({
        id: displayModuleId(id),
        renderedBytes: module.renderedLength,
      })),
    )
    .sort((left, right) => right.renderedBytes - left.renderedBytes)
    .slice(0, 10)

  return {
    gzipBytes: initialChunks.reduce(
      (total, chunk) => total + gzipSync(chunk.code).byteLength,
      0,
    ),
    initialFiles: [...initialFiles].sort(),
    largestModules,
    minifiedBytes: initialChunks.reduce(
      (total, chunk) => total + Buffer.byteLength(chunk.code),
      0,
    ),
  }
}

export function initialBundleBudget(maxGzipBytes: number): Plugin {
  return {
    name: 'purple-initial-bundle-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((output): BundleChunkInput[] => {
        if (output.type !== 'chunk') return []
        return [
          {
            code: output.code,
            fileName: output.fileName,
            imports: output.imports,
            isEntry: output.isEntry,
            modules: Object.fromEntries(
              Object.entries(output.modules).map(([id, module]) => [
                id,
                { renderedLength: module.renderedLength },
              ]),
            ),
          },
        ]
      })
      const report = measureInitialJavaScript(chunks)
      if (report.initialFiles.length === 0) {
        this.error('The hosted build did not produce a JavaScript entry chunk.')
      }
      const moduleLines = report.largestModules.map(
        (module) => `  ${formatBytes(module.renderedBytes)}  ${module.id}`,
      )
      this.info(
        [
          `Initial JavaScript: ${formatBytes(report.minifiedBytes)} minified, ${formatBytes(report.gzipBytes)} gzip across ${report.initialFiles.length} file(s)`,
          `Initial gzip budget: ${formatBytes(maxGzipBytes)}`,
          'Largest initial modules (rendered before minification):',
          ...moduleLines,
        ].join('\n'),
      )
      if (report.gzipBytes > maxGzipBytes) {
        this.error(
          `Initial JavaScript is ${formatBytes(report.gzipBytes)} gzip, exceeding the ${formatBytes(maxGzipBytes)} budget. Lazy-load noncritical code or deliberately raise the budget.`,
        )
      }
    },
  }
}

function displayModuleId(id: string): string {
  const cleanId = (id.replace(/^\0/, '').split('?')[0] ?? id).replaceAll('\\', '/')
  const dependencyIndex = cleanId.lastIndexOf('/node_modules/')
  if (dependencyIndex >= 0) {
    return `node_modules/${cleanId.slice(dependencyIndex + '/node_modules/'.length)}`
  }
  for (const directory of ['apps', 'packages', 'src', 'vite']) {
    const marker = `/${directory}/`
    const index = cleanId.indexOf(marker)
    if (index >= 0) return cleanId.slice(index + 1)
  }
  const relativeId = relative(process.cwd(), cleanId)
  return relativeId.startsWith('..') ? cleanId : relativeId
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KiB`
}
