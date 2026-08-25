# Purple Web

The Purple application is a Vite-built React SPA served as static assets by a
Cloudflare Worker.

```text
browser -> generativelanguage.googleapis.com  visitor's Gemini key
   |
   +-> localStorage                           key, chat, saved patterns
   +-> Strudel Web Audio                      playback
   +-> Purple Worker                          feedback and explicit sharing
          |
          +-> Email                           submitted feedback fields
          +-> D1                              shared patterns and votes
```

The Worker serves the static app and narrow feedback and public-pattern APIs.
Feedback is Turnstile-protected and sent to a fixed email destination. Pattern
titles and Strudel code reach D1 only when a visitor chooses `SHARE`; anonymous
votes are stored there too. The Worker has no accounts or inference code. The
visitor's Gemini key, chat, and personal library stay in the browser, and the
key is sent only to Google in a request header.

From the repository root:

```bash
pnpm run dev
pnpm run check
pnpm run deploy
```
