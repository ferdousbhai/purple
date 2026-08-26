# AGENTS.md - ferdousbhai/purple

This file records decisions that span more than one module. Read the files you
edit for local behavior.

## What this repo is

Purple is a local-first browser application for AI music production. Users
describe music in natural language, Gemini generates Strudel live-coding
patterns, and audio plays through Web Audio. The production site is
[soundspurple.com](https://soundspurple.com). MIT.

There is one application:

- `apps/web`: React SPA plus feedback and public-pattern routes on a Cloudflare Worker
- `packages/core`: shared dependency-free product logic
- `packages/ui`: React, CodeMirror, Strudel, playback, and persistence modules

The visitor's Gemini key, chat history, and personal library stay in the browser.
The page calls Google directly, and there is no account system. When a visitor
explicitly shares a pattern, its title and code are published to D1 so anyone
can play it. The Turnstile-protected feedback form sends only the fields a
visitor deliberately submits to a fixed email destination.

## Layout

```text
apps/web/
  src/components/purple-studio.tsx  browser composition
  src/lib/byok.ts                   browser-to-Google inference
  src/lib/patterns.ts               saved-pattern persistence
  src/lib/public-patterns.ts        public share, gallery, and vote client
  src/lib/media-channel.ts          iOS audio activation
  vite/                             build checks and AudioWorklet plugin
  worker/index.ts                   Worker routing and feedback delivery
  worker/patterns.ts                public pattern and anonymous vote API
  migrations/                       D1 public-pattern schema
  wrangler.jsonc                    assets, D1, rate limit, and email bindings
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
pnpm run deploy        # build, migrate remote D1, and deploy through Wrangler
```

## CI and deployment

GitHub Actions runs the JavaScript checks, dependency review, production build,
and Chromium flows on pushes and pull requests. Cloudflare Workers Builds
deploys `apps/web` on pushes to `master`: build command `pnpm run web:check`,
deploy command `pnpm --filter @purple/web run deploy`. The deploy script applies
pending D1 migrations before publishing the Worker.

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
- Cloudflare serves static assets, `/api/feedback`, and public pattern APIs.
  D1 stores only pattern titles, Strudel code, timestamps, and anonymous votes
  after an explicit share. Gemini keys, chat, the personal library, inference,
  and accounts must not move to the server without revisiting the local-first
  security model.
- `use-studio-chat` compacts into a rolling artifact only after Gemini reports
  more than `COMPACTION_TRIGGER_TOKENS` prompt tokens. Uncovered history remains
  uncapped, and late folding preserves Gemini prefix-cache efficiency.
- A first generated pattern lands in the editor and waits for explicit play.
  During active playback, a user-directed revision schedules a cancellable
  crossfade after five seconds. Browser audio must begin within a user gesture.
- Keep the current editor revision visible while a replacement streams and is
  validated. Publish the replacement atomically only after it passes validation.
- The browser playback owner outlives studio and public-pattern route changes.
  Keep internal navigation client-side so browsing or opening a pattern does
  not interrupt audio.
- Progression runs plan conservative, phrase-aligned holds and always retain
  manual early crossfade. A queued user direction replaces one automatic turn;
  the structured progression returned by that turn resumes the run.
- The Autoplay checkbox is standing intent, not a transport. An armed run
  engages only while a pattern is playing, and it synthesizes a "continue this
  pattern" turn when no model plan exists. Any teardown other than stopped
  playback or a new user prompt also clears the intent, so a run can never
  re-engage itself. The checkbox is in memory only.
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

`TURNSTILE_SECRET` is the only server secret. `PATTERNS_DB` and the rate-limit
bindings are non-secret Cloudflare resources. Visitors enter their Gemini key
in the application; it never reaches Purple's Worker.

## Gotchas

- Search `TODO` and `FIXME` before editing nearby code.
- Every iOS browser uses WebKit, so iOS audio activation behavior belongs in
  `apps/web/src/lib/media-channel.ts`.
- `apps/web/vite/superdough-worklet.ts` rewrites Strudel's AudioWorklet URL. Keep
  `scripts/verify-worklet-csp.mjs` aligned with its emitted filename.
- Without a saved session, the studio starts with its current default pattern.
- CSS follows `prefers-color-scheme`; there is no in-app theme toggle.
