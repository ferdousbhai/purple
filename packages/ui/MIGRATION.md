# Phase 2: pointing `riff-hosted` at `@riff/ui`

Issue ferdousbhai/riff#12 promoted the webview modules duplicated between this
repo and `riff-hosted` into shared packages. This repo's half is done; the issue
closes when `riff-hosted` consumes it. That change, in order:

## 1. Move the submodule pin

The pin must include the commit that added `packages/ui` and
`packages/core/src/types.ts`:

```
git -C vendor/riff fetch origin master
git -C vendor/riff checkout <that commit or later>
pnpm install
```

`pnpm-workspace.yaml` already includes `vendor/riff/packages/*`, so `@riff/ui`
appears as a workspace package on its own.

## 2. Wire the dependency

In `apps/web/package.json`, add `"@riff/ui": "workspace:*"`. `@strudel/web` can
be dropped from `apps/web` afterwards — `@riff/ui` owns that dependency now
(the desktop app dropped its direct dependency the same way). React and the two
CodeMirror packages stay: `@riff/ui` declares them as peers so there is exactly
one instance of each.

## 3. Delete the hosted copies

| delete | replaced by |
|---|---|
| `apps/web/src/music/use-strudel.ts` | `@riff/ui/use-strudel` |
| `apps/web/src/music/use-playback.ts` | `@riff/ui/use-playback` |
| `apps/web/src/music/playback-highlight.ts` | `@riff/ui/playback-highlight` |
| `apps/web/src/music/types.ts` | `@riff/core/types` (`PlaybackState`, `EvalResult`, `SourceRange`) |
| `apps/web/src/strudel-web.d.ts` | `packages/ui/src/strudel-web.d.ts` (pulled in by a triple-slash reference inside `use-strudel.ts`; nothing to configure) |

Then in `riff-studio.tsx` swap the `#/music/*` imports for the packages above.
`lib/byok.ts`'s `MAX_HISTORY_MESSAGES = 13` duplicates `MAX_CONTEXT_MESSAGES`
from `@riff/core/types`.

## 4. API deltas to absorb

The shared modules keep the desktop versions' behavior (newer than the hosted
fork). Differences the hosted call sites must absorb:

- `useStrudel` returns `getSchedulerPosition(): { cycle, cps }` instead of
  `getCycle()`; it validates cps and throws when scheduler timing is missing.
  It also gains `isAudioReady()`, and `evaluate(code, { hushBefore })` takes an
  options object instead of a positional boolean.
- `useStrudel`/`usePlayback` accept `StrudelAudioOptions`. Hosted passes
  nothing: the default `ensureRunningContext` resumes the context and verifies
  it is running — equivalent to the hosted inline logic. The WebKitGTK priming
  quirks live only in the desktop's injected implementation.
- `usePlayback` differences from the hosted fork:
  - a failed transition dispatches `transitionFailed`: state returns to
    `"playing"` **with `error` set**, so the UI can show it (hosted dropped the
    playing-state error).
  - `stop()`/a new `play()` cancels a pending crossfade wait immediately
    (`cancelTransitionWait`); the hosted 50 ms poll only noticed on its next
    tick.
  - highlight ranges are polled only while `"playing"`; hosted also polled
    during `"transitioning"` (the transition stub pattern has no stable source
    ranges, so this drops nothing visible).
  - a scheduler-timing failure inside the crossfade wait surfaces as an
    `evaluation` error and hushes, instead of waiting forever.
- User-facing copy now says "Click Play …" where the hosted fork said
  "Click START." — either relabel the hosted button or revisit making the
  activation hint injectable.
- `evaluate` verifies the result is a real pattern (`queryArc` present), not
  merely truthy, and logs highlight-query failures with `console.warn` instead
  of swallowing them.

## 5. Optional, same shape: `RiffBackend`

`@riff/core/types` now defines the adapter interface
(`stream`/`abortStream`/`generateTitle`/`suggestTransitions`) that the desktop
`backend.ts` satisfies. The hosted agent and BYOK paths can each be wrapped in
one to converge the composers later; nothing in phase 2 requires it.

## 6. Checks

`pnpm run build:ci` in `riff-hosted` (submodule update, pin check, install,
typegen, test + typecheck + build) is the gate. The desktop repo's hosted-guard
workflow now triggers on all of `packages/**`, so later shared-package edits
run the hosted checks automatically.
