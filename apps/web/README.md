# Purple Web

The Purple application is a Vite-built React SPA served as static assets by a
Cloudflare Worker.

```text
browser <- MCP relay <- visitor's own agent      pattern code and session state
   |
   +-> localStorage                              pairing code, saved patterns
   +-> Strudel Web Audio                         playback
   +-> Purple Worker                             feedback and explicit sharing
          |
          +-> Email                              submitted feedback fields
          +-> D1                                 shared patterns and votes
```

The Worker serves the static app, the per-tab MCP relay, and narrow feedback
and public-pattern APIs. Feedback is Turnstile-protected and sent to a fixed
email destination. Pattern titles and Strudel code reach D1 only when a visitor
chooses `SHARE`; anonymous votes are stored there too. The Worker has no
accounts and runs no inference: the visitor's own agent writes the music, and
the relay carries nothing but session state and pattern code.

From the repository root:

```bash
pnpm run dev
pnpm run check
pnpm run deploy
```
