# Contributing

Thanks for helping with Purple.

## Quick start

Purple requires Node.js 22 and pnpm 10.

```bash
pnpm install
pnpm run dev
```

Run `pnpm run check` before opening a pull request. It covers linting, unit
tests, TypeScript, and the production browser build. Run `pnpm run test:browser`
when changing playback, persistence, chat, or other user flows.

## Layout

- `apps/web` is the browser application and browser-to-Gemini transport.
- `packages/core` holds dependency-free product logic.
- `packages/ui` holds shared React, CodeMirror, and Strudel modules.
- `apps/web/vite` holds web build checks and the same-origin AudioWorklet plugin.
- `tools` and `scripts` hold repository checks.

Keep `packages/core` free of runtime dependencies because it ships in the
browser bundle. Product behavior shared across the studio belongs in
`packages/core` or `packages/ui`; browser composition belongs in `apps/web`.

Do not commit `node_modules`, `dist`, `.env`, `.dev.vars`, or `.wrangler`.
Use the repository-pinned `pnpm@10.27.0`.
