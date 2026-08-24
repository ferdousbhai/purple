# Purple Web

The Purple application is a Vite-built React SPA served as static assets by a
Cloudflare Worker.

```text
browser -> generativelanguage.googleapis.com  visitor's Gemini key
   |
   +-> localStorage                           key, chat, saved patterns
   +-> Strudel Web Audio                      playback
```

The Worker has no bindings, storage, accounts, or inference code. The visitor's
Gemini key is stored in localStorage and sent only to Google in a request header.

From the repository root:

```bash
pnpm run dev
pnpm run check
pnpm run deploy
```
