/* oxlint-disable anti-slop/no-module-mocking -- This exercises real playback orchestration against a deterministic audio-engine boundary. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted mutable fixtures need explicit collection types. */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePlayback } from '@purple/ui/use-playback'

const engine = vi.hoisted(() => ({
  activate: (async () => undefined) as () => Promise<void>,
  evaluateResults: [] as unknown[],
  evaluateCalls: [] as string[],
  hushCalls: 0,
  cycle: 0,
  cps: 2,
}))

vi.mock('@purple/ui/use-strudel', () => ({
  useStrudel: () => ({
    activate: () => engine.activate(),
    evaluate: async (code: string) => {
      engine.evaluateCalls.push(code)
      return engine.evaluateResults.shift() ?? { ok: true as const }
    },
    validate: async () => [],
    hush: () => {
      engine.hushCalls++
    },
    getSchedulerPosition: () => ({ cycle: engine.cycle, cps: engine.cps }),
    getActiveSourceRanges: () => [],
  }),
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

beforeEach(() => {
  engine.activate = async () => undefined
  engine.evaluateResults.length = 0
  engine.evaluateCalls.length = 0
  engine.hushCalls = 0
  engine.cycle = 0
  engine.cps = 2
})

afterEach(() => vi.useRealTimers())

describe('usePlayback cancellation in Chromium', () => {
  it('cancels loading before a delayed audio activation can evaluate', async () => {
    const activation = deferred<void>()
    engine.activate = () => activation.promise
    const hook = renderHook(() => usePlayback())
    let playPromise!: ReturnType<typeof hook.result.current.play>

    await act(() => {
      playPromise = hook.result.current.play('s("bd")')
    })
    expect(hook.result.current.playbackState).toBe('loading')

    await act(() => hook.result.current.stop())
    expect(hook.result.current.playbackState).toBe('stopped')

    let result: Awaited<typeof playPromise> | undefined
    await act(async () => {
      activation.resolve()
      result = await playPromise
    })

    expect(result).toEqual({ ok: false, kind: 'cancelled' })
    expect(engine.evaluateCalls).toEqual([])
    expect(hook.result.current.playbackState).toBe('stopped')
  })

  it('cancels an in-progress crossfade before the final pattern lands', async () => {
    const hook = renderHook(() => usePlayback())

    await act(async () => {
      await hook.result.current.play('s("bd")')
    })
    expect(hook.result.current.playbackState).toBe('playing')

    let transitionPromise!: ReturnType<typeof hook.result.current.transition>
    await act(() => {
      transitionPromise = hook.result.current.transition('s("hh*8")', 4)
    })
    await waitFor(() => expect(hook.result.current.playbackState).toBe('transitioning'))

    await act(() => hook.result.current.stop())
    let result: Awaited<typeof transitionPromise> | undefined
    await act(async () => {
      result = await transitionPromise
    })

    expect(result).toEqual({ ok: false, kind: 'cancelled' })
    expect(engine.evaluateCalls).toHaveLength(2)
    expect(engine.evaluateCalls).not.toContain('s("hh*8")')
    expect(engine.hushCalls).toBeGreaterThan(0)
    expect(hook.result.current.playbackState).toBe('stopped')
  })

  it('reports musical countdown progress while waiting for progression cycles', async () => {
    vi.useFakeTimers()
    const hook = renderHook(() => usePlayback())
    const progress = vi.fn()
    let waitPromise!: ReturnType<typeof hook.result.current.waitForCycles>

    act(() => {
      waitPromise = hook.result.current.waitForCycles(4, undefined, progress)
    })
    expect(progress).toHaveBeenLastCalledWith(4, 2)

    engine.cycle = 1
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(progress).toHaveBeenLastCalledWith(3, 2)

    act(() => hook.result.current.stop())
    await expect(waitPromise).resolves.toEqual({ ok: false, kind: 'cancelled' })
  })
})
