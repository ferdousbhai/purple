# Riff

AI-powered music production desktop app. Users describe music in natural language, Gemini generates Strudel live-coding patterns, audio plays natively in the webview. Split-pane layout: editable code editor (left) + chat (right).

## Stack

- **Electrobun** — lightweight desktop app framework (Bun runtime + system webview)
- **React + Tailwind CSS** — view UI with dark theme
- **Vite** — React build/HMR
- **CodeMirror 6** — editable Strudel code editor (JavaScript + oneDark theme)
- **react-resizable-panels** — split-pane layout
- **@strudel/web 1.3.0** — music engine (direct import in webview)
- **@google/genai** — Gemini streaming (Bun main process, streamed to webview via RPC)

## Commands

- `pnpm run start` — build Vite + launch Electrobun dev
- `pnpm run dev:hmr` — launch with Vite HMR for hot reload
- `pnpm run dev` — Electrobun dev with file watching (no HMR)
- `pnpm run build:canary` — build for canary release
- `pnpm run test` — run vitest suite
- `pnpm run typecheck` — run the TypeScript compiler without emitting

## Architecture

```
src/
  bun/                             # Electrobun main process (Bun runtime)
    index.ts                       # Window creation, RPC handlers, Gemini streaming
  mainview/                        # React UI (system webview)
    index.html                     # HTML entry point
    main.tsx                       # createRoot entry + RPC init
    App.tsx                        # Split-pane root and prompt/playback controller
    app.css                        # Tailwind imports + global styles
    audio-activation.ts            # User-gesture AudioContext activation
    audio-shim.ts                  # Narrow Linux WebKitGTK compatibility shim
    rpc.ts                         # Electroview RPC bridge (stream handler callbacks)
    components/
      EditorPanel.tsx              # CodeMirror editor + playback controls
      ChatPanel.tsx                # Messages + input
      PlaybackControls.tsx         # Play/Stop buttons
      MessageBubble.tsx            # Chat message rendering
      StreamingText.tsx            # Animated streaming response
      CodeBlockRenderer.tsx        # Markdown code block rendering
      ApiKeyDialog.tsx             # API key settings form
    hooks/
      useChat.ts                   # RPC-based Gemini streaming + state
      useRiffController.ts         # Prompt, playback, startup, and settings orchestration
      useStrudel.ts                # Direct @strudel/web wrapper
      usePlayback.ts               # Wraps useStrudel with state
      useKeyboardShortcuts.ts      # Ctrl+., Escape handlers
  shared/                          # Imported by both bun and mainview
    types.ts                       # Message, PlaybackState, EvalResult
    rpc-schema.ts                  # Typed RPC schema (replaces IPC channels)
    pattern-extractor.ts           # Regex code block extraction
    cli.ts                         # Startup argument and preset parser
```

## Data Flow

```
User types message → ChatPanel → RPC request startStream →
  Bun process: ai.models.generateContentStream() →
  RPC message streamDelta per token → ChatPanel renders streaming text →
  RPC message streamDone → extractPattern() → auto-populate EditorPanel →
  User sends a prompt or clicks START AUDIO → useStrudel.evaluate(code) →
  @strudel/web plays audio natively in webview
```

## RPC Schema

| Name | Direction | Type | Purpose |
|------|-----------|------|---------|
| `startStream` | webview→bun | request | Start Gemini streaming |
| `abortStream` | webview→bun | request | Cancel stream |
| `streamDelta` | bun→webview | message | Text token (fire-and-forget) |
| `streamDone` | bun→webview | message | Stream complete |
| `streamError` | bun→webview | message | Stream error |

## Key Patterns

- **Strudel runs in webview**: `@strudel/web` imports directly in the system WebKitGTK webview on Linux; CEF is not bundled.
- **RPC streaming**: Gemini tokens stream from bun→webview with a request ID on every message so stale chunks can be ignored safely. The `setStreamHandler` pattern bridges Electrobun's module-level RPC handlers with React's external-system subscription.
- **busyRef in useChat**: `useRef` guards against concurrent `sendMessage` calls (closures capture stale state).
- **Auto-retry**: If generated Strudel code fails evaluation, the error is sent back to Gemini (max 2 retries).
- **Strudel audio init**: AudioContext creation/resume starts synchronously inside a user gesture, then the same context is passed to `initStrudel()`.
- **Dirt-Samples**: `samples("github:tidalcycles/Dirt-Samples/master")` must be called in `initStrudel({ prebake })` to load bd/sd/hh/cp etc. Without this, `s()` patterns produce no sound.
- **Gemini client**: The Bun process keeps a client cached for the effective key and defaults Gemini 3 models to low thinking for low time-to-first-token. Unsupported configuration errors are surfaced directly; there is no silent model fallback.
- **ApplicationMenu required**: Electrobun needs explicit menu setup for Cmd+C/V/X to work in the webview.
- **Keyboard shortcuts**: Ctrl+. stops playback, Escape cancels stream, Enter sends messages, Ctrl+Enter evaluates code in editor.

## Strudel API (webview context)

- `initStrudel()` — initialize audio engine
- `evaluate(code, true)` — transpile + autoplay a pattern
- `hush()` — stop all playback

## Environment

- `GEMINI_API_KEY` — optional alternative to saving a key with the in-app `KEY` dialog
- `GEMINI_MODEL` — optional, defaults to `gemini-3.7-flash`
- `GEMINI_THINKING_LEVEL` — optional Gemini 3 thinking level, defaults to `low`
