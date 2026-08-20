# AGENTS.md — ferdousbhai/purple

Index for agents and contributors. Code is self-documenting — read the file you are editing. `AGENTS.md` is only an index; gotchas live as comments next to the code they explain.

## What this repo is

AI music production. Users describe music in natural language, Gemini generates Strudel live-coding patterns, audio plays in the webview. One repo, two apps sharing `packages/*`. MIT.

- Desktop: Tauri 2 shell (Rust) around a WebKitGTK webview (`src/`, `src-tauri/`)
- Web: local-first TanStack Start app on Cloudflare Workers (`apps/web`) — no accounts, no server-side storage or inference; the visitor's Gemini key, chat, and saved patterns stay in the browser

## Layout

```
src-tauri/        # Rust shell. Transport only — no prompts, no parsing, no product logic
  tauri.conf.json, capabilities/default.json
  src/main.rs, lib.rs, gemini.rs, secrets.rs, patterns.rs, startup.rs
src/
  mainview/       # React UI in system webview
    index.html, main.tsx, App.tsx, app.css
    backend.ts    # the only module that imports @tauri-apps/api
    audio-activation.ts, audio-shim.ts
    components/   # EditorPanel, ChatPanel, PlaybackControls, MessageBubble, StreamingText, CodeBlockRenderer, ApiKeyDialog
    hooks/        # useChat, usePurpleController, useKeyboardShortcuts, useTransitionSuggestions
  shared/         # desktop-only types.ts, cli.ts (+ parser tests)
apps/
  web/            # @purple/web — hosted app (purple-web Worker, soundspurple.com)
    src/server.ts             # Worker entry: serves the shell, nothing else
    src/components/purple-studio.tsx  # the whole web UI
    src/lib/byok.ts           # browser → Google inference + chat persistence
    src/db-collections/       # TanStack DB localStorage collection (saved patterns)
    wrangler.jsonc            # no bindings; custom domains soundspurple.com + www
packages/
  core/           # @purple/core — shared, dependency-free
    src/pattern.ts, prompts.ts, recipes.ts, transitions.ts, compaction.ts, types.ts, index.ts
  ui/             # @purple/ui — shared webview modules (React/CodeMirror/@strudel/web)
    src/use-strudel.ts, use-playback.ts, playback-highlight.ts, strudel-web.d.ts
packaging/        # PKGBUILD + purple.desktop
scripts/          # install-user.sh
```

## Commands

```
pnpm install
pnpm run dev          # tauri dev (Vite + Rust shell)
pnpm run dev:webview  # Vite alone, browser-only desktop UI work
pnpm run build        # release binary at src-tauri/target/release/purple
pnpm run web:dev      # web app dev server (localhost:3000)
pnpm run web:deploy   # build + wrangler deploy the purple-web Worker
pnpm run web:check    # web test/typecheck/build
pnpm run test         # vitest run (desktop + packages)
pnpm run test:rust    # cargo test
pnpm run typecheck    # tsc --noEmit
pnpm run check        # lint + test + test:rust + typecheck + build:webview + web:check
```

## CI and deployment

There is no GitHub Actions workflow — Cloudflare **Workers Builds** is the
only automated gate. It deploys `apps/web` on every push to `master`: build
command `pnpm run web:check`, deploy command
`pnpm --filter @purple/web exec wrangler deploy`. `web:check` fails the build
before the deploy command runs when a test or typecheck breaks. Everything
else (desktop tests, cargo, lint) is covered by running `pnpm run check`
locally before pushing.

## Key files to read before changing

- `src/mainview/backend.ts` + `src-tauri/src/gemini.rs` — the whole desktop backend contract: `stream_pattern` over a `tauri::ipc::Channel`, `generate_json` for structured output (the caller passes the prompt and schema, so Rust stays generic)
- `src/mainview/hooks/useChat.ts` — `busyRef` guard, auto-retry (max 2) on eval failure, background compaction
- `apps/web/src/lib/byok.ts` — the web app's only inference path: browser → Google with the visitor's key (header, never URL); chat persists in localStorage and compacts with the shared `@purple/core` policy
- `packages/ui/src/use-strudel.ts` + `src/mainview/audio-activation.ts` — AudioContext must be created synchronously in user gesture, then passed to `initStrudel({ prebake })` with `samples("github:tidalcycles/Dirt-Samples/master")`; the desktop injects `requireRunningAudioContext` via `StrudelAudioOptions`
- `packages/core/src/*` — pattern/recipes/transitions/compaction, self-contained; tests alongside

## Conventions

- Code explains itself — name things clearly, keep functions small. Add comments only for non-obvious behavior or workarounds.
- Prefer existing libraries and official docs patterns over custom implementations.
- `pnpm` workspace is `packages/*` + `apps/*`; `@purple/core` and `@purple/ui` are `workspace:*`.
- `@purple/core` stays dependency-free (it bundles into the Worker); anything that imports React, CodeMirror or `@strudel/web` belongs in `@purple/ui`.
- No server-side secrets: the Worker has no bindings. Anything stateful belongs in the visitor's browser.
- Do not commit `node_modules`, `dist`, `src-tauri/target`, `.env`, `.wrangler`.

## Gotchas (see code comments for details)

- Search `TODO`/`FIXME` in code for known workarounds; each has a comment explaining why.
- Linux WebKitGTK quirks are isolated in `src/mainview/audio-shim.ts`.
- Nothing product-shaped goes into `src-tauri/`. If the web app could ever want it, it belongs in `@purple/core`.
- `apps/web/wrangler.jsonc` targets the `purple-web` Worker (fresh for the rebrand, no DO history) and declares the soundspurple.com custom domains; `wrangler deploy` attaches them.
