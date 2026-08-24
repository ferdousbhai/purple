# AGENTS.md - ferdousbhai/purple

This file records decisions that span more than one module. Read the files you
edit for local behavior.

## What this repo is

Purple is a local-first browser application for AI music production. Users
describe music in natural language, Gemini generates Strudel live-coding
patterns, and audio plays through Web Audio. The production site is
[soundspurple.com](https://soundspurple.com). MIT.

There is one application:

- `apps/web`: React SPA served as static assets by a Cloudflare Worker
- `packages/core`: shared dependency-free product logic
- `packages/ui`: React, CodeMirror, Strudel, playback, and persistence modules

The visitor's Gemini key, chat history, and saved patterns stay in the browser.
The page calls Google directly. There is no server code, account system, or
Cloudflare binding.

## Layout

```text
apps/web/
  src/components/purple-studio.tsx  browser composition
  src/lib/byok.ts                   browser-to-Google inference
  src/lib/patterns.ts               saved-pattern persistence
  src/lib/media-channel.ts          iOS audio activation
  vite/                             build checks and AudioWorklet plugin
  wrangler.jsonc                    assets-only Worker configuration
packages/core/                      prompts, parsing, recipes, compaction,
                                    repair, validation, transitions, types
packages/ui/                        Strudel, safe interpreter, editor, chat,
                                    playback, session persistence
```

## Commands

```bash
pnpm run dev           # Vite development server on localhost:3000
pnpm run build         # production browser build
pnpm run preview       # preview the production build
pnpm run test          # unit and integration tests
pnpm run test:browser  # Chromium browser flows
pnpm run typecheck     # all TypeScript projects
pnpm run check         # lint, test, typecheck, build
pnpm run deploy        # build and deploy through Wrangler
```

## CI and deployment

GitHub Actions runs the JavaScript checks, dependency review, production build,
and Chromium flows on pushes and pull requests. Cloudflare Workers Builds
deploys `apps/web` on pushes to `master`: build command `pnpm run web:check`,
deploy command `pnpm --filter @purple/web exec wrangler deploy`.

Repository workflows do not deploy the site.

## Decisions

- `@purple/core` stays dependency-free so product logic remains portable and
  inexpensive to bundle.
- Keep browser orchestration in plain TypeScript and React. Do not introduce an
  application-wide effects runtime or dependency-injection framework without a
  concrete failure that the existing capability interfaces cannot address and
  a measured, acceptable bundle cost.
- `apps/web/src/lib/byok.ts` is the only inference path. Gemini requests leave
  the browser directly and carry the visitor's key in a header.
- Cloudflare serves static assets only. Do not add server-side secrets or
  stateful bindings without revisiting the local-first security model.
- `use-studio-chat` compacts into a rolling artifact only after Gemini reports
  more than `COMPACTION_TRIGGER_TOKENS` prompt tokens. Uncovered history remains
  uncapped, and late folding preserves Gemini prefix-cache efficiency.
- A generated pattern lands in the editor and waits for an explicit play or
  crossfade action. Browser audio must begin within a user gesture.
- `safe-strudel.ts` interprets one allowlisted expression without `eval` or
  `Function`. Statements, browser globals, computed properties, loaders, and
  custom worklets are rejected.
- Remote `gm_*` soundfonts remain unavailable because their upstream loader
  executes fetched JavaScript. Unknown sounds play silence. Keep the prompt
  reference, registry audit, and Strudel example tests in sync.
- Chat transcripts and the working pattern persist together through
  `@purple/ui/session-store`. Restoring one without the other desynchronizes a
  session.
- The AudioWorklet is emitted and served from Purple's origin so the production
  content security policy does not need a third-party script exception.

## Conventions

- Use clear names and small functions. Comment non-obvious behavior or browser
  workarounds.
- Do not use em dashes. `pnpm run lint:text` rejects them.
- Prefer existing libraries and official documentation patterns.
- Keep browser composition in `apps/web`, dependency-free logic in
  `packages/core`, and React or Strudel modules in `packages/ui`.
- Do not commit `node_modules`, `dist`, `.env`, `.dev.vars`, or `.wrangler`.

## Environment

No server-side environment variables are required. Visitors enter their Gemini
key in the application.

## Gotchas

- Search `TODO` and `FIXME` before editing nearby code.
- Every iOS browser uses WebKit, so iOS audio activation behavior belongs in
  `apps/web/src/lib/media-channel.ts`.
- `apps/web/vite/superdough-worklet.ts` rewrites Strudel's AudioWorklet URL. Keep
  `scripts/verify-worklet-csp.mjs` aligned with its emitted filename.
- Without a saved session, the studio starts with its current default pattern.
- CSS follows `prefers-color-scheme` and stores explicit theme choices in the
  browser.
