# AGENTS.md - ferdousbhai/purple

Index plus the decisions that span more than one file. Code is self-documenting: read the
file you are editing. Gotchas local to one function stay as comments next to that code;
what lives here is the reasoning no single file owns.

## What this repo is

AI music production. Users describe music in natural language, Gemini generates Strudel
live-coding patterns, audio plays in the webview. One repo, two apps sharing `packages/*`. MIT.

- Desktop: Tauri 2 shell (Rust) around a WebKitGTK webview (`src/`, `src-tauri/`)
- Web: local-first static SPA on an assets-only Cloudflare Worker (`apps/web`), no server
  code at all; the visitor's Gemini key, chat, and saved patterns stay in the browser

## Layout

```
src-tauri/src/    # Rust shell. Transport only, no prompts/parsing/product logic.
                  # gemini.rs (SSE transport), secrets.rs (keyring), patterns.rs (save
                  # dialog), startup.rs (argv), mpris.rs (D-Bus media keys), theme.rs
src/mainview/     # React UI in the system webview
  backend.ts      # the ONLY module importing @tauri-apps/api
  hooks/          # desktop composition: usePurpleController, useKeyboardShortcuts
src/shared/       # desktop-only types.ts, cli.ts
apps/web/         # @purple/web, the purple-web Worker at soundspurple.com
  src/lib/byok.ts # the web app's only inference path: browser to Google, key in a header
packages/core/    # @purple/core, shared and dependency-free (prompts, parsers, recipes,
                  # compaction, repair, validation, types, PurpleBackend)
packages/ui/      # @purple/ui, shared modules needing React/CodeMirror/@strudel/web
                  # (use-strudel, use-studio-chat, use-generated-pattern, safe-strudel,
                  # session-store, pinned-samples, pattern-editor)
packaging/        # PKGBUILD + com.soundspurple.Purple desktop/AppStream metadata
```

## Commands

```
pnpm run dev          # tauri dev (Vite + Rust shell)
pnpm run dev:webview  # Vite alone, browser-only desktop UI work
pnpm run build        # release binary at src-tauri/target/release/purple
pnpm run web:dev      # web app dev server (localhost:3000)
pnpm run web:deploy   # build + wrangler deploy the purple-web Worker
pnpm run test         # vitest run (desktop + packages)
pnpm run test:rust    # cargo test
pnpm run check        # JS/Rust lint+format, tests, typechecks, both webview builds
```

## CI and deployment

GitHub Actions runs the complete JavaScript/Rust/native Linux gate on pushes and pull
requests, reviews new dependencies on pull requests, and builds an attested Arch package
plus SBOM/checksums from version tags. Cloudflare **Workers Builds** independently deploys
`apps/web` on every push to `master`: build `pnpm run web:check`, deploy
`pnpm --filter @purple/web exec wrangler deploy`. Repository-side workflows never deploy
the web app or publish to the AUR.

## Tauri commands

| Command | Purpose |
|---------|---------|
| `stream_pattern` | Stream a pattern response; deltas arrive on a `Channel` |
| `abort_stream` | Cancel the in-flight stream |
| `generate_json` | One-shot structured generation (caller supplies prompt + JSON schema) |
| `api_key_status` / `save_api_key` / `clear_api_key` | Gemini key in the OS keyring |
| `save_pattern` | Native save dialog, writes the pattern |
| `startup_args` | Raw argv for `parseCliArgs` in TypeScript |
| `log_message` | Webview `console.warn`/`error` into the shell log |
| `set_playback_state` | Playback status + title for MPRIS (no-op off Linux) |
| `get_system_theme` | Omarchy background/foreground/accent, or `null` |

## Key files to read before changing

- `src/mainview/backend.ts` + `src-tauri/src/gemini.rs`: the whole desktop backend contract
- `packages/ui/src/use-studio-chat.ts` + `use-generated-pattern.ts`: shared streaming,
  compaction, and the repair budget
- `apps/web/src/lib/byok.ts`: the web app's only inference path
- `packages/ui/src/use-strudel.ts` + `safe-strudel.ts` + `src/mainview/audio-activation.ts`
- `packages/core/src/*`: pattern/recipes/transitions/compaction/repair, tests alongside

## Decisions

- **The Gemini transport stays in Rust, hand-rolled** (decided 2026-08-21). Keeping HTTP in
  the shell means the API key never enters the webview: Rust reads the keyring and attaches
  it, the renderer never holds the credential. Hand-rolled beats a community crate because
  none supports the Interactions API, they lag Gemini's fast-moving field changes (e.g.
  `thinking_level`), and everything an SDK would abstract already lives in TypeScript.
  Do not swap in a crate or move this fetch into the webview without revisiting both halves.
  The Interactions API also gets implicit prefix caching with `store: false` (verified live
  2026-08-21: `usage.total_cached_tokens` covered ~70% of a repeated prompt), so there is no
  caching reason to migrate to `generateContent`.
- **Rust holds no product logic.** Prompts, schemas, parsers, retry policy and argument
  parsing live in TypeScript because `apps/web` shares them. `generate_json` takes the
  system instruction and schema as parameters for exactly this reason.
- **`@purple/core` stays dependency-free** (it bundles into a Worker). Anything importing
  React, CodeMirror or `@strudel/web` belongs in `@purple/ui`. The shared engine takes a
  `StrudelAudioOptions` capability so desktop injects `requireRunningAudioContext` and the
  WebKitGTK quirks stay desktop-side instead of shipping to the web app.
- **One adapter**: `backend.ts` implements the shared `PurpleBackend` interface; hooks talk
  to it, never to `invoke` directly. The web app implements the same interface over BYOK.
- **Channels, not events**: streaming uses `tauri::ipc::Channel`, which guarantees ordered
  delivery, so the UI never filters stale chunks.
- **Fold late, not early.** `use-studio-chat` compacts into a rolling artifact (prose
  summary + latest pattern verbatim) only once Gemini's own reported prompt size passes
  `COMPACTION_TRIGGER_TOKENS` (100k). Everything since the fold is resent uncapped: implicit
  prefix caching makes the append-only resend cheap, and folding earlier would invalidate
  the cached prefix and lose session detail.
- **Staged playback**: a prompt never plays on its own. The pattern lands in the editor and
  waits for XFADE or PLAY, because a webview only starts audio inside a user gesture. A
  failed evaluation of a generated (not hand-edited) pattern goes back to Gemini as a hidden
  message; validation and playback repair share `MAX_RETRIES` (10) per pattern
  (`packages/core/src/repair.ts`).
- **Safe Strudel runtime**: `safe-strudel.ts` interprets one allowlisted expression without
  `eval`/`Function`. Statements, browser globals, computed properties, custom worklets and
  loaders are rejected. Remote `gm_*` soundfonts are intentionally unavailable because their
  upstream loader executes fetched JavaScript. Unknown names play SILENCE, so
  `STRUDEL_REFERENCE`, the registry audit, and `strudel-examples.test.ts` must stay in sync.
- **Session persistence**: `@purple/ui/session-store` is the one place chat transcripts and
  the working pattern persist, together, because restoring a transcript without the pattern
  it produced desyncs the session.
- **MPRIS gesture rule**: a media key can stop playback any time but only *start* it if a
  user gesture already unlocked audio (`isAudioReady`). A D-Bus event is not a gesture.

## Conventions

- Code explains itself: name things clearly, keep functions small. Comment only non-obvious
  behavior or workarounds.
- **Do not use em dashes.** `pnpm run lint:text` fails on any em dash anywhere in the repo.
- Prefer existing libraries and official docs patterns over custom implementations.
- `pnpm` workspace is `packages/*` + `apps/*`; `@purple/core` and `@purple/ui` are `workspace:*`.
- No server-side secrets: the Worker has no bindings. Anything stateful lives in the browser.
- The desktop key lives in the OS credential store; machines without a secret service fall
  back to an owner-only `$XDG_CONFIG_HOME/purple/config.json` (mode `0600` in a `0700` dir).
  A key saved by a pre-rebrand Riff install is adopted at startup.
- Do not commit `node_modules`, `dist`, `src-tauri/target`, `.env`, `.wrangler`.

## Environment

- `GEMINI_API_KEY`: optional alternative to the in-app `KEY` dialog
- `GEMINI_MODEL`: defaults to `gemini-3.7-flash`
- `GEMINI_THINKING_LEVEL`: `low`/`medium`/`high`, defaults to `low`
- `PURPLE_DISABLE_DMABUF=1`: disable WebKitGTK's DMABUF renderer when a Mesa/WebKitGTK
  combination opens a blank or transparent window

## Gotchas

- Search `TODO`/`FIXME` in code; each has a comment explaining why.
- Linux WebKitGTK quirks are isolated in `src/mainview/audio-shim.ts`.
- Nothing product-shaped goes into `src-tauri/`. If the web app could ever want it, it
  belongs in `@purple/core`.
- `PULSE_PROP_application.name=Purple` is set in `run()` before the webview spawns, so
  mixers show "Purple" instead of a generic WebKit client.
- Without Omarchy, the CSS palette follows `prefers-color-scheme`.
