/**
 * Fails on any em dash in the repo. Walks the tree directly instead of
 * shelling out to `git grep`: CI's Arch container check runs on a workspace
 * without Git metadata, where every git command dies with exit 128.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const EM_DASH = '\u2014'
/** Mirrors .gitignore: what the old `git grep --untracked` scan never saw. */
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.vite',
  '.wrangler',
  'artifacts',
  'build',
  'dist',
  'gen',
  'node_modules',
  'out',
  'target',
])
const SKIPPED_PATHS = new Set(['packaging/src', 'packaging/pkg'])

const offenders = []

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !SKIPPED_PATHS.has(path)) scan(path)
      continue
    }
    if (!entry.isFile()) continue
    const contents = readFileSync(path)
    if (contents.includes(0)) continue // binary
    const text = contents.toString('utf8')
    if (!text.includes(EM_DASH)) continue
    text.split('\n').forEach((line, index) => {
      if (line.includes(EM_DASH)) offenders.push(`${path}:${index + 1}`)
    })
  }
}

scan('.')

if (offenders.length > 0) {
  console.error('Em dashes are not allowed. Use commas, colons, parentheses, or separate sentences.')
  console.error(offenders.join('\n'))
  process.exit(1)
}
