import { spawnSync } from 'node:child_process'

const emDash = String.fromCodePoint(0x2014)
const result = spawnSync('git', ['grep', '--untracked', '-I', '-n', emDash, '--', '.'], {
  encoding: 'utf8',
})

if (result.status === 1) process.exit(0)

if (result.status === 0) {
  console.error('Em dashes are not allowed. Use commas, colons, parentheses, or separate sentences.')
  console.error(result.stdout.trimEnd())
  process.exit(1)
}

console.error(result.stderr.trimEnd() || 'Could not scan the repository for em dashes.')
process.exit(result.status ?? 1)
