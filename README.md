# Purple

Purple is a local-first browser studio for making music with Strudel. Your own
coding agent writes the patterns; the tab plays them, and you can inspect, edit,
and save every one.

Use the hosted app at [soundspurple.com](https://soundspurple.com), or run it
locally. Purple has no accounts and no server-side inference. Your saved
patterns and the tab's pairing code stay in your browser. Patterns you share,
from the SHARE button or through your agent's `share_pattern` tool, publish
their title, Strudel code, and optional handle through Cloudflare D1 so anyone
can play them. If you deliberately submit the feedback form, its
category, message, and optional reply address are sent through a
Turnstile-protected Cloudflare Worker to the maintainer's inbox.

## Requirements

- A current browser with Web Audio support
- An MCP-capable coding agent for writing music (editing and playback work
  without one)

## Connecting your agent

Register Purple's Streamable HTTP MCP endpoint once:

```bash
claude mcp add --transport http purple https://soundspurple.com/mcp
codex mcp add purple --url https://soundspurple.com/mcp
```

The client opens Purple in your browser and asks for one Allow click. That
pairs it with the studio tab in that browser, and no code is ever typed. Then
ask your agent for music. It reads Purple's Strudel reference, writes a
pattern, plays it, and keeps the set evolving by crossfading into each next
section. Keep the tab open; if sound is blocked, press `PLAY` once so the
browser unlocks Web Audio.

Clients without MCP authorization support use the pairing URL shown under
AGENT, then OTHER, in the studio: `https://soundspurple.com/mcp/<pairing-code>`.

Either way, the pairing code is minted in your browser and is the only way an
agent reaches your tab; the Allow click puts it inside a signed token. The
Worker signs those tokens with the `TOKEN_SECRET` secret. `packages/agent-bridge`
is a fully offline alternative that runs the same tool surface over 127.0.0.1.

## Development

Purple requires Node.js 22 and pnpm 10.

```bash
pnpm install
pnpm run dev
```

The development server runs at `http://localhost:3000`.

Useful commands:

```bash
pnpm run dev           # Start the Vite development server
pnpm run build         # Build the production app
pnpm run preview       # Preview the production build
pnpm run test          # Run unit and integration tests
pnpm run test:browser  # Run browser flow tests in Chromium
pnpm run typecheck     # Check all TypeScript projects
pnpm run check         # Lint, test, typecheck, and build
pnpm run deploy        # Build, migrate remote D1, and deploy with Wrangler
```

## Architecture

- `apps/web` contains the React application, the Worker, and the hosted MCP
  relay that pairs an agent with a tab.
- `packages/core` contains dependency-free prompts, parsing, validation, the
  agent tool surface, transitions, and shared types.
- `packages/ui` contains the Strudel engine, safe expression interpreter,
  CodeMirror editor, playback controller, agent link client, and browser
  persistence.
- `packages/agent-bridge` contains purple-mcp, the offline stdio bridge.
- `apps/web/vite` contains build checks and the plugin that serves Strudel's
  AudioWorklet from the application's own origin.

Cloudflare Workers serves the static application assets, the `/mcp` MCP
endpoint with its OAuth surface (`/authorize`, `/oauth/*`, `/.well-known/*`),
the `/mcp/<code>` and `/link/<code>` pairing endpoints, `/llms.txt`, a
stateless `/api/feedback` route, and the public pattern API. Feedback validates
Cloudflare Turnstile and uses a fixed-destination email binding without storing
submissions. Shared pattern titles, code, and handles, plus anonymous votes,
are stored in D1; OAuth tokens are signed with `TOKEN_SECRET` and never stored. Cloudflare
Workers Builds deploys the site on pushes to `master` after running
`pnpm run check`.

## Keyboard shortcuts

- `Ctrl+Enter`: play or re-run the pattern in the editor.
- `Ctrl+.`: stop playback.

## Troubleshooting

If audio does not start, click the play control once so the browser can unlock
Web Audio. Check the selected audio output and system volume if playback remains
silent.

If your agent reports that no tab is connected, make sure the Purple tab is open
and that the pairing address it registered matches the one the agent panel shows.

## Licensing

Purple-authored source is MIT licensed. Production bundles also incorporate
AGPL-3.0-or-later Strudel and Kabelsalat components. See
`THIRD_PARTY_NOTICES.md` and `LICENSE-AGPL-3.0-or-later` for details.
