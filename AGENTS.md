# AGENTS.md — ferdousbhai/riff (open core)

Index for agents and contributors. Code is self-documenting — read the file you are editing. `AGENTS.md` is only an index; gotchas live as comments next to the code they explain.

## What this repo is

Desktop app for AI music production. Users describe music in natural language, Gemini generates Strudel live-coding patterns, audio plays in the webview. Tauri 2 shell (Rust) around a WebKitGTK webview. MIT.

- `riff` (this repo): open core — desktop app + shared music logic
- `riff-hosted` (private): closed Cloudflare Workers build at `ferdousbhai/riff-hosted` — `apps/web`

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
    hooks/        # useChat, useRiffController, useStrudel, usePlayback, useKeyboardShortcuts, useTransitionSuggestions
    editor/       # playbackHighlight
  shared/         # types.ts, cli.ts (+ parser tests)
packages/
  core/           # @riff/core — shared music logic (submodule vendor/riff in riff-hosted)
    src/pattern.ts, prompts.ts, recipes.ts, transitions.ts, index.ts
packaging/        # PKGBUILD + riff.desktop
scripts/          # install-user.sh
```

## Commands

```
pnpm install
pnpm run dev        # tauri dev (Vite + Rust shell)
pnpm run dev:web    # Vite alone, browser-only UI work
pnpm run build      # release binary at src-tauri/target/release/riff
pnpm run test       # vitest run
pnpm run test:rust  # cargo test
pnpm run typecheck  # tsc --noEmit
pnpm run check      # test + test:rust + typecheck + build:web
```

## Key files to read before changing

- `src/mainview/backend.ts` + `src-tauri/src/gemini.rs` — the whole backend contract: `stream_pattern` over a `tauri::ipc::Channel`, `generate_json` for structured output (the caller passes the prompt and schema, so Rust stays generic)
- `src/mainview/hooks/useChat.ts` — `busyRef` guard, auto-retry (max 2) on eval failure
- `src/mainview/hooks/useStrudel.ts` + `src/mainview/audio-activation.ts` — AudioContext must be created synchronously in user gesture, then passed to `initStrudel({ prebake })` with `samples("github:tidalcycles/Dirt-Samples/master")`
- `packages/core/src/*` — pattern/recipes/transitions, self-contained; tests in `core.test.ts`

## Conventions

- Code explains itself — name things clearly, keep functions small. Add comments only for non-obvious behavior or workarounds.
- Prefer existing libraries and official docs patterns over custom implementations.
- `pnpm` workspaces (`apps/*`, `packages/*`). `@riff/core` is `workspace:*`.
- Do not commit `node_modules`, `dist`, `.wrangler`, `worker-configuration.d.ts`, `.env`/`.dev.vars`.

## Hosted split

`apps/web` lives in private `ferdousbhai/riff-hosted` (fresh copy). `packages/core` is shared automatically — edit it here in `riff`, `riff-hosted` pulls it via `vendor/riff` submodule (`vendor/riff/packages/*` in workspace).

Workflow for shared code:
1. Edit `packages/core/src/*` in this repo (`riff`) and `pnpm run check`
2. Commit and push to `master` (`ferdousbhai/riff`)
3. In `ferdousbhai/riff-hosted`: `git submodule update --remote vendor/riff && pnpm install`, commit the pointer bump, deploy

## Gotchas (see code comments for details)

- Search `TODO`/`FIXME` in code for known workarounds; each has a comment explaining why.
- Linux WebKitGTK quirks are isolated in `src/mainview/audio-shim.ts`.
- Nothing product-shaped goes into `src-tauri/`. If the hosted app could ever want it, it belongs in `@riff/core`.
