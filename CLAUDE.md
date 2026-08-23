# Purple

AI-powered music production. Users describe music in natural language, Gemini generates Strudel live-coding patterns, audio plays natively in the webview. Split-pane layout: editable code editor (left) + chat (right). One repo, two apps sharing `packages/*`: the Tauri desktop app (root) and a local-first web app (`apps/web`, deployed as the `purple-web` Cloudflare Worker at soundspurple.com).

## Stack

- **Tauri 2** — native Wayland/X11 window, Rust shell around the system webview (WebKitGTK 4.1 + GTK3 on Linux)
- **React + Tailwind CSS** — view UI with dark theme
- **Vite** — React build/HMR (started by `tauri dev`)
- **CodeMirror 6** — editable Strudel code editor (JavaScript + oneDark theme)
- **react-resizable-panels** — split-pane layout
- **@strudel/web 1.3.0** — music engine (direct import in webview)
- **Gemini Interactions API** — streamed from Rust via `reqwest` (SSE), rendered in the webview

## Commands

- `pnpm run dev` / `pnpm run start` — `tauri dev` (Vite + the Rust shell, hot reload)
- `pnpm run dev:webview` — Vite alone, for browser-only desktop UI work
- `pnpm run build` — release binary at `src-tauri/target/release/purple`
- `pnpm run build:webview` — Vite build into `dist/`
- `pnpm run web:dev` — web app dev server (localhost:3000)
- `pnpm run web:deploy` — build + `wrangler deploy` the purple-web Worker
- `pnpm run web:check` — web test/typecheck/build
- `pnpm run test` — vitest suite (desktop + packages)
- `pnpm run test:rust` — cargo test for the shell
- `pnpm run typecheck` — TypeScript compiler without emitting
- `pnpm run check` — lint + test + test:rust + typecheck + build:webview + web:check

## Architecture

```
src-tauri/                         # Rust shell — no product logic lives here
  tauri.conf.json                  # Window, frontend paths, bundle metadata
  capabilities/default.json        # Tauri permissions (core only)
  src/
    main.rs                        # Entry point
    lib.rs                         # Plugins, state, command registry
    gemini.rs                      # Interactions API transport (SSE streaming + structured JSON)
    secrets.rs                     # API key in the OS keyring, 0600 file fallback
    patterns.rs                    # Native save dialog + write
    startup.rs                     # argv passthrough, webview log forwarding
    mpris.rs                       # MPRIS media controls over D-Bus (Linux only)
    theme.rs                       # Best-effort Omarchy theme colors
src/
  mainview/                        # React UI (system webview)
    index.html                     # HTML entry point
    main.tsx                       # createRoot entry + console forwarding
    App.tsx                        # Split-pane root and prompt/playback controller
    app.css                        # Tailwind imports + global styles
    backend.ts                     # The only module that talks to Tauri
    audio-activation.ts            # User-gesture AudioContext activation
    audio-shim.ts                  # Narrow Linux WebKitGTK compatibility shim
    system-theme.ts                # Maps Omarchy theme colors onto the CSS palette tokens
    components/                    # EditorPanel, ChatPanel, PlaybackControls, MessageBubble,
                                   # StreamingText, CodeBlockRenderer, ApiKeyDialog
    hooks/
      useChat.ts                   # Streaming chat state
      usePurpleController.ts         # Prompt, playback, startup, and settings orchestration
      useTransitionSuggestions.ts  # Next-move suggestions
      useKeyboardShortcuts.ts      # Ctrl+., Escape handlers
  shared/                          # Desktop-only types and CLI grammar
    types.ts, cli.ts
apps/web/                          # @purple/web — local-first static SPA on an assets-only
                                   # Worker (zero server code; the BYOK Gemini key, saved
                                   # patterns and chat live in the visitor's browser)
  index.html                       # SPA entry: boot shell, fonts, script tag
  public/404.html                  # Served for unknown paths (assets not_found_handling)
  src/main.tsx                     # createRoot + crash screen
  src/components/purple-studio.tsx   # The whole web UI
  src/lib/byok.ts                  # Browser → Google inference + chat persistence/compaction
  src/lib/patterns.ts              # Saved patterns in localStorage (useSyncExternalStore)
  wrangler.jsonc                   # Assets-only; custom domains soundspurple.com + www
packages/core/                     # @purple/core — shared between both apps; dependency-free
                                   # (prompts, parsers, recipes, shared types, PurpleBackend)
packages/ui/                       # @purple/ui — shared webview modules that need React/CodeMirror/
                                   # @strudel/web: use-strudel, use-playback, playback-highlight,
                                   # plus the hand-written @strudel/web type declarations
packaging/                         # PKGBUILD + desktop entry
```

## Data Flow

```
User types message → ChatPanel → backend.streamPattern() → invoke("stream_pattern") →
  Rust: POST /v1beta/interactions (stream) →
  Channel<StreamEvent> delta per token → ChatPanel renders streaming text →
  done → extractPattern() → auto-populate EditorPanel →
  User sends a prompt or clicks START → useStrudel.evaluate(code) →
  @strudel/web plays audio natively in webview
```

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
| `set_playback_state` | Playback status + pattern title for the MPRIS desktop controls (no-op off Linux) |
| `get_system_theme` | Background/foreground/accent from the active Omarchy theme, or `null` |

## Key Patterns

- **`@purple/core` stays dependency-free** (it is bundled into a Cloudflare Worker); anything that imports React, CodeMirror or `@strudel/web` belongs in `@purple/ui`. The shared engine (`useStrudel`/`usePlayback`) takes a `StrudelAudioOptions` capability: the desktop injects `requireRunningAudioContext` from `audio-activation.ts` so the WebKitGTK quirks (non-standard "interrupted" state, silent-buffer priming) stay desktop-side instead of shipping to the web app. `audio-shim.ts` likewise stays desktop-only.
- **Rust holds no product logic**: prompts, JSON schemas, parsers, retry policy and argument parsing all live in TypeScript (`@purple/core`, `src/shared`), because `apps/web` shares them. `generate_json` takes the system instruction and schema as parameters for exactly this reason.
- **The Gemini transport stays in Rust, hand-rolled — deliberately** (decided 2026-08-21): keeping the HTTP layer in the shell means the API key never enters the webview (Rust reads the keyring and attaches it; the renderer never holds the credential). Hand-rolled beats a community crate because none supports the Interactions API, they lag Gemini's fast-moving field changes (e.g. `thinking_level`), and everything an SDK would abstract already lives in TypeScript — `gemini.rs` is only the thin transport. Do not swap in a crate or move this fetch into the webview without revisiting both halves of that rationale. The Interactions API also gets implicit prefix caching with `store: false` (verified live 2026-08-21: `usage.total_cached_tokens` covered ~70% of a repeated prompt), so the uncapped-context economics hold on the desktop exactly as on the web — there is no caching reason to migrate to `generateContent`.
- **One adapter**: `src/mainview/backend.ts` is the only module importing `@tauri-apps/api`. Hooks talk to it, never to `invoke` directly. It implements the shared `PurpleBackend` interface from `@purple/core/types` (`stream`/`abortStream`/`generateTitle`/`suggestTransitions`); the web app provides its own implementation over its BYOK path (`apps/web/src/lib/byok.ts` — browser → Google directly, key in a header, never through a server).
- **Channels, not events**: streaming uses `tauri::ipc::Channel`, which guarantees ordered delivery, so the UI does not need to filter stale chunks.
- **Interactions API**: requests go to `POST /v1beta/interactions` with `input` as `user_input`/`model_output` steps, `stream: true`, `store: false`. Text deltas only count when their step is `model_output` — reasoning steps stream their own deltas. `status: "incomplete"` means the model hit its output limit.
- **busyRef in useChat**: `useRef` guards against concurrent `sendMessage` calls (closures capture stale state).
- **Background compaction**: `useChat` folds the whole history into a rolling artifact — prose summary + latest pattern code verbatim (`@purple/core/compaction`) — via a background `generate_json` call after a send settles. Each generation sends the artifact plus everything since the fold, uncapped: nothing is ever trimmed, Gemini's implicit prefix caching keeps the append-only resend cheap, and the only bound is the fold itself, which triggers once Gemini's own reported prompt size for the latest generation (`usage.total_input_tokens` on desktop, `usageMetadata.promptTokenCount` on web — exact, not estimated) passes `COMPACTION_TRIGGER_TOKENS` (100k). Folding earlier would invalidate the cached prefix and lose session detail.
- **Staged playback**: a prompt never plays on its own. The generated pattern lands in the editor and waits for XFADE or PLAY, because a webview only starts audio inside a user gesture. When PLAY/XFADE fails to evaluate a generated (not hand-edited) pattern, the error goes back to Gemini as a hidden message and each fix replays, up to 2 retries (`patternRepair.ts`).
- **Strudel audio init**: AudioContext creation/resume starts synchronously inside a user gesture, then the same context is passed to `initStrudel()`.
- **Safe Strudel runtime**: `packages/ui/src/safe-strudel.ts` parses and interprets one allowlisted Strudel expression without `eval`/`Function`; statements, browser globals, computed properties, custom worklets, and loaders are rejected. The prebake loads validated manifests and lazy audio from immutable commit URLs for Dirt-Samples, tidal-drum-machines (`bank()`), and piano, plus local synths and ZZFX. Remote `gm_*` soundfonts are intentionally unavailable because their upstream loader executes fetched JavaScript. Unknown names play SILENCE, so `STRUDEL_REFERENCE`, the live registry audit, and `strudel-examples.test.ts` must stay in sync.
- **Secrets**: the key lives in the OS credential store (Secret Service). A key saved by a pre-rebrand Riff install (its keyring entry or `~/.config/riff/config.json`) is adopted at startup; machines without a secret service fall back to an unencrypted owner-only file at `$XDG_CONFIG_HOME/purple/config.json` (normally `~/.config/purple/config.json`, mode `0600` inside a `0700` directory).
- **Single instance**: a second `purple-music …` focuses the running window and forwards its arguments over the internal `purple://startup-args` event.
- **MPRIS**: `mpris.rs` registers `org.mpris.MediaPlayer2.Purple` (crate `mpris-server`) and only bridges D-Bus: media-key requests become `purple://media-control` events (`"play"`/`"pause"`/`"play-pause"`/`"stop"`) that `usePurpleController` interprets, and the webview reports state back via `set_playback_state`. A media key can stop playback any time but only *start* it if a user gesture already unlocked audio (`isAudioReady`) — a D-Bus event is not a gesture, so the request is otherwise ignored.
- **PipeWire/Pulse client name**: `PULSE_PROP_application.name=Purple` (+ icon/media name) is set in `run()` before the webview spawns; WebKitGTK's WebProcess inherits it, so mixers show "Purple" instead of a generic WebKit client.
- **Linux theming**: without Omarchy, the CSS palette follows `prefers-color-scheme`. `get_system_theme` reads Omarchy's `omarchy/current/theme` (`~/.local/state`, then `~/.config`) — `colors.toml` first, `alacritty.toml` as fallback — and `system-theme.ts` gives those colors and their declared light/dark mode precedence at startup.
- **Keyboard shortcuts**: Ctrl+. stops playback, Escape cancels stream, Enter sends messages, Ctrl+Enter evaluates code in editor.

## Strudel API (webview context)

- `initStrudel()` — initialize audio engine
- `evaluate(code, true)` — transpile + autoplay a pattern
- `hush()` — stop all playback

## Environment

- `GEMINI_API_KEY` — optional alternative to saving a key with the in-app `KEY` dialog
- `GEMINI_MODEL` — optional, defaults to `gemini-3.7-flash`
- `GEMINI_THINKING_LEVEL` — optional Gemini 3 thinking level (`low`/`medium`/`high`), defaults to `low`
- `PURPLE_DISABLE_DMABUF=1` — disable WebKitGTK's DMABUF renderer when a Mesa/WebKitGTK combination opens a blank or transparent window
