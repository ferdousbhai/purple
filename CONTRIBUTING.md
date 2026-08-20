# Contributing

Thanks for helping with Riff! This is the open-core desktop app at `ferdousbhai/riff`.

## Quick start

```bash
pnpm install
pnpm run check   # vitest + cargo test + typecheck + vite build — must pass before PR
```

Riff needs [Rust](https://rustup.rs) 1.85+ alongside Node 22 and pnpm 10, plus
the WebKitGTK development packages listed in [README.md](./README.md).

## Commands

- `pnpm run dev` — Vite and the Tauri shell together, with hot reload
- `pnpm run dev:webview` — Vite alone, for browser-only interface work
- `pnpm run web:dev` — web app dev server (localhost:3000)
- `pnpm run build` — release binary at `src-tauri/target/release/riff`
- `pnpm run test` / `pnpm run test:rust` / `pnpm run typecheck` — single checks

## Layout

- `src-tauri/` — Rust shell: window, Gemini transport, keyring, dialogs. No product logic
- `src/mainview/` — React UI; `backend.ts` is the only module that talks to Tauri
- `src/shared/` — types and the CLI grammar
- `apps/web/` — local-first web app on Cloudflare Workers
- `packages/core/` — music logic shared by the desktop and web apps
- `packaging/` — PKGBUILD and desktop entry

See [AGENTS.md](./AGENTS.md) for file-by-file guidance.

## Before you push

1. `pnpm run check` must be green
2. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and
   `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
3. `bash -n scripts/*.sh`
4. Don't commit `node_modules/ dist/ src-tauri/target/ .env` — they're in `.gitignore`

`pnpm run check` covers both apps, so a `packages/*` change that breaks the
web app fails right away. Keep `packages/core` free of runtime dependencies —
it bundles into the Cloudflare Worker.

Use `pnpm@10.27.0` (`npm install --global pnpm@10.27.0`).
