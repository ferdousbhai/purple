# Purple

Local-first browser studio where the visitor's own MCP agent writes and plays Strudel music.

## Code index

- `apps/web/src/components/purple-studio.tsx` and `apps/web/src/components/agent-card.tsx`: studio composition and the agent pairing panel
- `apps/web/src/lib/agent-link-storage.ts`: the tab's pairing code and relay endpoints
- `apps/web/src/lib/media-channel.ts` and `apps/web/src/lib/playback.ts`: browser audio ownership and activation
- `apps/web/src/lib/patterns.ts` and `apps/web/src/lib/public-patterns.ts`: private library and explicit public sharing
- `apps/web/worker/index.ts`, `apps/web/worker/http.ts`, `apps/web/worker/feedback.ts`, and `apps/web/worker/patterns.ts`: Worker routing, feedback, public patterns, and votes
- `apps/web/vite/superdough-worklet.ts`: same-origin AudioWorklet emission
- `packages/core/src/`: dependency-free Strudel reference, showcase patterns, parsing, validation, and transitions
- `packages/core/src/agent-link.ts` and `packages/core/src/agent-tools.ts`: agent wire protocol, the shared MCP tool surface, and the instructions that teach a continuous set
- `apps/web/worker/agent-relay.ts`: hosted MCP endpoint and the Durable Object pairing an agent with its tab
- `apps/web/worker/oauth.ts` and `apps/web/src/components/agent-authorize.tsx`: MCP authorization with the browser as the authenticator, and the Allow page
- `packages/agent-bridge/src/`: purple-mcp, the optional fully offline stdio bridge
- `packages/ui/src/use-agent-link.ts`: browser WebSocket client answering agent requests
- `packages/ui/src/safe-strudel.ts`: allowlisted Strudel interpreter
- `packages/ui/src/use-playback.ts`: playback, crossfades, and derived transport state
- `packages/ui/src/session-store.ts`: working-pattern persistence
- `scripts/verify-worklet-csp.mjs`: worklet/CSP alignment check
- `apps/web/migrations/` and `apps/web/wrangler.jsonc`: public-pattern schema and Worker bindings

## Boundaries

- Purple runs no inference. The agent is the composer; the studio validates, plays, and stores. A browser-minted pairing code is the only way an agent reaches a tab: it travels either inside a token the person's own browser approved on `/authorize`, or pasted as `/mcp/<code>`. The Worker keeps no accounts and no token tables; every OAuth artifact is a signed payload. The relay (or the offline purple-mcp bridge) carries nothing but session state and pattern code.
- The personal library and the working pattern stay in the browser. Only an explicit share may publish a pattern title and code to D1.
- A set keeps evolving because `AGENT_INSTRUCTIONS` says so: both MCP front ends advertise them on initialize, and the studio holds no autoplay loop of its own.
- Keep browser composition in `apps/web`, dependency-free product logic in `packages/core`, and React, editor, Strudel, playback, and persistence modules in `packages/ui`.
- Browser audio activation and iOS behavior belong in `apps/web/src/lib/media-channel.ts`; safe evaluation belongs in `packages/ui/src/safe-strudel.ts`.

## Commands

```sh
pnpm run check
pnpm run test:browser
```

Do not deploy unless explicitly requested; the deploy script applies remote D1 migrations.
