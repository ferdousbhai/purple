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
    hooks/        # useChat, useRiffController, useKeyboardShortcuts, useTransitionSuggestions
  shared/         # desktop-only types.ts, cli.ts (+ parser tests)
packages/
  core/           # @riff/core — shared, dependency-free (submodule vendor/riff in riff-hosted)
    src/pattern.ts, prompts.ts, recipes.ts, transitions.ts, types.ts, index.ts
  ui/             # @riff/ui — shared webview modules (React/CodeMirror/@strudel/web)
    src/use-strudel.ts, use-playback.ts, playback-highlight.ts, strudel-web.d.ts
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
- `packages/ui/src/use-strudel.ts` + `src/mainview/audio-activation.ts` — AudioContext must be created synchronously in user gesture, then passed to `initStrudel({ prebake })` with `samples("github:tidalcycles/Dirt-Samples/master")`; the desktop injects `requireRunningAudioContext` via `StrudelAudioOptions`
- `packages/core/src/*` — pattern/recipes/transitions, self-contained; tests in `core.test.ts`

## Conventions

- Code explains itself — name things clearly, keep functions small. Add comments only for non-obvious behavior or workarounds.
- Prefer existing libraries and official docs patterns over custom implementations.
- `pnpm` workspace is `packages/*`; `@riff/core` and `@riff/ui` are `workspace:*`.
- Do not commit `node_modules`, `dist`, `src-tauri/target`, `.env`.

## Hosted split

`apps/web` lives in private `ferdousbhai/riff-hosted`. `packages/core` and `packages/ui` are the only shared code: `riff-hosted` consumes them through the `vendor/riff` submodule, which points at **one frozen commit of this repo** and stays there until someone moves it.

**A change under `packages/**` is a two-repo change.** It is not finished when `riff` is pushed — it is finished when `riff-hosted`'s pin moves onto that commit. Everything else in this repo (the shell, the desktop UI, packaging) touches nothing hosted uses, so it needs no coordination.

That matters because core is mostly *prompts*. A stale pin does not break a build or fail a test; it just means the hosted product keeps serving the previous `SYSTEM_PROMPT` to paying users.

What is automated, so it does not depend on anyone remembering:
- `.github/workflows/hosted-guard.yml` here runs `riff-hosted`'s checks against a core commit as it lands, so a break is reported by the commit that caused it (needs the `HOSTED_REPO_TOKEN` secret).
- `.github/workflows/core-bump.yml` there opens a pull request each Monday moving the pin to core tip, but only when the hosted checks pass against it.
- `pnpm run build:ci` there prints how far the pin is behind on every deploy build.

To move it now rather than waiting for Monday, in `ferdousbhai/riff-hosted`:
```
git submodule update --remote vendor/riff && pnpm install
pnpm run check        # then commit the pointer bump
```

## Gotchas (see code comments for details)

- Search `TODO`/`FIXME` in code for known workarounds; each has a comment explaining why.
- Linux WebKitGTK quirks are isolated in `src/mainview/audio-shim.ts`.
- Nothing product-shaped goes into `src-tauri/`. If the hosted app could ever want it, it belongs in `@riff/core`.
