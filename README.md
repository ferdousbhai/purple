# Purple

Purple is a local-first browser app for making music with AI. Describe a musical
idea in plain English and Gemini writes a Strudel pattern that you can inspect,
edit, and play in the studio.

Use the hosted app at [soundspurple.com](https://soundspurple.com), or run it
locally. Purple has no accounts or server-side inference. Your Gemini API key,
chat history, and personal library remain in your browser, and generation
requests go directly from the page to Google. Patterns you explicitly share
publish their title and Strudel code through Cloudflare D1 so anyone can play
them. If you deliberately submit the feedback form, its category, message, and
optional reply address are sent through a Turnstile-protected Cloudflare Worker
to the maintainer's inbox.

## Requirements

- A current browser with Web Audio support
- An internet connection for Gemini requests
- A Google Gemini API key

Create a key in [Google AI Studio](https://aistudio.google.com/app/apikey), open
Purple, select `KEY`, and save it. The key is stored in localStorage for the
current browser profile and sent to Google in a request header. Clear it from
Purple when using a shared browser profile.

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

- `apps/web` contains the React application and its browser-to-Gemini transport.
- `packages/core` contains dependency-free prompts, parsing, validation, repair,
  compaction, recipes, transitions, and shared types.
- `packages/ui` contains the Strudel engine, safe expression interpreter,
  CodeMirror editor, playback controller, chat hooks, and browser persistence.
- `apps/web/vite` contains build checks and the plugin that serves Strudel's
  AudioWorklet from the application's own origin.

Cloudflare Workers serves the static application assets, a stateless
`/api/feedback` route, and the public pattern API. Feedback validates Cloudflare
Turnstile and uses a fixed-destination email binding without storing
submissions. Explicitly shared pattern titles and code, plus anonymous votes,
are stored in D1. Cloudflare Workers Builds deploys the site on pushes to
`master` after running `pnpm run check`.

## Keyboard shortcuts

- `Enter`: send a chat message.
- `Ctrl+Enter`: play or re-run the pattern in the editor.
- `Ctrl+.`: stop playback.
- `Escape`: stop Gemini while it is generating a response.

## Troubleshooting

If audio does not start, click the play control once so the browser can unlock
Web Audio. Check the selected audio output and system volume if playback remains
silent.

For an invalid-key error, open `KEY`, replace the stored key, and try again. A
rate-limit error comes from the Gemini API and normally clears after waiting.

## Licensing

Purple-authored source is MIT licensed. Production bundles also incorporate
AGPL-3.0-or-later Strudel and Kabelsalat components. See
`THIRD_PARTY_NOTICES.md` and `LICENSE-AGPL-3.0-or-later` for details.
