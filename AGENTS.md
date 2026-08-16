# AGENTS.md — ferdousbhai/riff (open core)

Index for agents and contributors. Code is self-documenting — read the file you are editing. `AGENTS.md` is only an index; gotchas live as comments next to the code they explain.

## What this repo is

Desktop app for AI music production. Users describe music in natural language, Gemini generates Strudel live-coding patterns, audio plays in the webview. MIT.

- `riff` (this repo): open core — desktop app + shared music logic
- `riff-hosted` (private): closed Cloudflare Workers build at `ferdousbhai/riff-hosted` — `apps/web`

## Layout

```
src/
  bun/            # Electrobun main process (Bun). Window, RPC handlers, Gemini streaming
    index.ts
    system-prompt.ts
  mainview/       # React UI in system webview
    index.html, main.tsx, App.tsx, app.css
    rpc.ts, audio-activation.ts, audio-shim.ts
    components/   # EditorPanel, ChatPanel, PlaybackControls, MessageBubble, StreamingText, CodeBlockRenderer, ApiKeyDialog
    hooks/        # useChat, useRiffController, useStrudel, usePlayback, useKeyboardShortcuts, useTransitionSuggestions
    editor/       # playbackHighlight
  shared/         # Used by both bun and mainview
    types.ts, rpc-schema.ts, pattern-extractor.ts, pattern-title.ts, transition-suggestions.ts, cli.ts
packages/
  core/           # @riff/core — shared music logic (also vendored in riff-hosted)
    src/pattern.ts, prompts.ts, recipes.ts, transitions.ts, index.ts
apps/             # reserved for pnpm workspace; hosted app lives in riff-hosted (see below)
scripts/          # package-linux-user.sh etc.
```

## Commands

```
pnpm install
pnpm run start      # vite build + Electrobun dev
pnpm run dev:hmr    # vite HMR
pnpm run dev        # Electrobun watch
pnpm run test       # vitest run
pnpm run typecheck  # tsc --noEmit
pnpm run check      # test + typecheck + build:web + web check
```

## Key files to read before changing

- `src/bun/index.ts` + `src/mainview/rpc.ts` + `src/shared/rpc-schema.ts` — RPC streaming (`startStream`/`streamDelta`/`streamDone`/`streamError`, request ID for stale-chunk ignore)
- `src/mainview/hooks/useChat.ts` — `busyRef` guard, auto-retry (max 2) on eval failure
- `src/mainview/hooks/useStrudel.ts` + `src/mainview/audio-activation.ts` — AudioContext must be created synchronously in user gesture, then passed to `initStrudel({ prebake })` with `samples("github:tidalcycles/Dirt-Samples/master")`
- `packages/core/src/*` — pattern/recipes/transitions, self-contained; tests in `core.test.ts`

## Conventions

- Code explains itself — name things clearly, keep functions small. Add comments only for non-obvious behavior or workarounds.
- Prefer existing libraries and official docs patterns over custom implementations.
- `pnpm` workspaces (`apps/*`, `packages/*`). `@riff/core` is `workspace:*`.
- Do not commit `node_modules`, `dist`, `.wrangler`, `worker-configuration.d.ts`, `.env`/`.dev.vars`.

## Hosted split

`apps/web` was moved to private `ferdousbhai/riff-hosted` (fresh copy). `packages/core` is vendored there until it lands on public `master`, then it becomes a `vendor/riff` submodule. See `riff-hosted/README.md` for sync steps.

## Gotchas (see code comments for details)

- Search `TODO`/`FIXME` in code for known workarounds; each has a comment explaining why.
- Linux WebKitGTK quirks are isolated in `src/mainview/audio-shim.ts`.
