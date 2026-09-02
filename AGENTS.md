# Purple

Local-first browser application for generating and playing Strudel music with a visitor-supplied Gemini key.

## Code index

- `apps/web/src/components/purple-studio.tsx`: studio composition
- `apps/web/src/lib/byok.ts` and `apps/web/src/lib/byok-storage.ts`: browser-to-Gemini inference and key storage
- `apps/web/src/lib/media-channel.ts` and `apps/web/src/lib/playback.ts`: browser audio ownership and activation
- `apps/web/src/lib/patterns.ts` and `apps/web/src/lib/public-patterns.ts`: private library and explicit public sharing
- `apps/web/worker/index.ts`, `apps/web/worker/http.ts`, and `apps/web/worker/patterns.ts`: Worker routing, feedback, public patterns, and votes
- `apps/web/vite/superdough-worklet.ts`: same-origin AudioWorklet emission
- `packages/core/src/`: dependency-free prompts, parsing, validation, compaction, repair, and progression
- `packages/ui/src/safe-strudel.ts`: allowlisted Strudel interpreter
- `packages/ui/src/use-studio-chat.ts`: chat streaming, compaction, and progression orchestration
- `packages/ui/src/use-playback.ts` and `packages/ui/src/playback-flow.ts`: playback transitions
- `packages/ui/src/session-store.ts`: transcript and working-pattern persistence
- `scripts/verify-worklet-csp.mjs`: worklet/CSP alignment check
- `apps/web/migrations/` and `apps/web/wrangler.jsonc`: public-pattern schema and Worker bindings

## Boundaries

- Gemini keys, inference, chat history, and the personal library stay in the browser. Only an explicit share may publish a pattern title and code to D1.
- Keep browser composition in `apps/web`, dependency-free product logic in `packages/core`, and React, editor, Strudel, playback, and persistence modules in `packages/ui`.
- Browser audio activation and iOS behavior belong in `apps/web/src/lib/media-channel.ts`; safe evaluation belongs in `packages/ui/src/safe-strudel.ts`.

## Commands

```sh
pnpm run check
pnpm run test:browser
```

Do not deploy unless explicitly requested; the deploy script applies remote D1 migrations.
