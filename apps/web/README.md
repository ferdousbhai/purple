# Riff Web

The web app is a TanStack Start application on Cloudflare Workers. The Worker
only serves the app shell — everything stateful is local-first:

```text
browser ── HTTPS ── generativelanguage.googleapis.com (visitor's own Gemini key)
   │
   ├─ TanStack DB / localStorage   # saved patterns, chat history, API key
   └─ Strudel Web Audio            # playback in the page
```

There are no accounts, no billing, and no server-side inference or storage.
The Gemini key is entered by the visitor, kept in localStorage, and sent only
to Google (in a header, never a URL). Chat history is compacted in the browser
with the shared `@riff/core` compaction policy (`src/lib/byok.ts`).

From the repo root: `pnpm run web:dev`, `pnpm run web:check`,
`pnpm run web:deploy`.
