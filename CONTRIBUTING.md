# Contributing

Thanks for helping with Riff! This is the open-core desktop app at `ferdousbhai/riff`.

## Quick start

```bash
pnpm install
pnpm run check   # tests + typecheck + vite build — must pass before PR
```

## Commands

- `pnpm run start` — build and launch desktop app
- `bin/riff` / `riff` — detached dev launcher (see `scripts/riff.sh`), `riff --rebuild` rebuilds `dist` first
- `pnpm run dev` — Electrobun watch
- `pnpm run dev:hmr` — Vite HMR
- `pnpm run test` / `pnpm run typecheck` — single checks

## Layout

- `src/bun/` — Electrobun main process
- `src/mainview/` — React UI
- `src/shared/` — shared types/cli/rpc
- `packages/core/` — music logic shared with `riff-hosted` via submodule

See [AGENTS.md](./AGENTS.md) for file-by-file guidance.

## Before you push

1. `pnpm run check` must be green
2. `bash -n bin/riff scripts/*.sh` (CI does this)
3. Don't commit `node_modules/ dist/ build/ artifacts/ .env` — they're in `.gitignore`

Use `pnpm@10.27.0` (`npm install --global pnpm@10.27.0`).
