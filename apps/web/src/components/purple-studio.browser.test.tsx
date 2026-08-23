/* oxlint-disable anti-slop/no-module-mocking -- The browser flow keeps network, storage, editor, and audio boundaries deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted mutable fixtures need explicit collection and result types. */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PurpleStudio } from './purple-studio'
import { useGeneratedPattern } from '@purple/ui/use-generated-pattern'
import type { TransitionResult } from '@purple/ui/use-playback'
import type { EvalResult, PlaybackState, SourceRange } from '@purple/core/types'

const FIRST_PATTERN = 's("bd sd")'
const SECOND_PATTERN = 's("hh*8")'
const FIXED_PATTERN = 's("hh*4").gain(0.5)'

// The real playback unions, so the mock cannot drift from the contract.
interface TestPlaybackSnapshot {
  playbackState: PlaybackState
  error: string | null
  activeCode: string
  activeRanges: readonly SourceRange[]
}

type TestPlaybackResult = EvalResult | TransitionResult

interface TestPlaybackOptions {
  reportEvaluationError?: boolean
}

const studio = vi.hoisted(() => ({
  generations: [] as string[],
  repairs: [] as string[],
  repairMessages: [] as string[],
  streamMessages: [] as unknown[],
  validationCalls: [] as string[],
  validationResults: new Map<string, unknown[][]>(),
  playCalls: [] as string[],
  playResults: [] as unknown[],
  transitionCalls: [] as string[],
  transitionResults: [] as unknown[],
  prepareAudioCalls: 0,
  stopCalls: 0,
  activeCode: '',
}))

vi.mock('#/lib/byok', () => ({
  clearByokChat: () => true,
  getByokKey: () => 'browser-test-key',
  loadByokChat: () => null,
  saveByokChat: () => true,
  setByokKey: () => undefined,
  createByokBackend: () => ({
    async stream(messages: unknown[], onDelta: (text: string) => void) {
      studio.streamMessages.push(messages)
      const pattern = studio.generations.shift()
      if (!pattern) throw new Error('The test did not queue a generation.')
      onDelta(`Here is the pattern.\n\n\`\`\`js\n${pattern}\n\`\`\``)
      return { promptTokens: 20, truncated: false }
    },
    async abortStream() {},
    async generateTitle() {
      return { ok: true as const, title: 'Browser smoke pattern' }
    },
    async suggestTransitions() {
      return { ok: true as const, suggestions: [] }
    },
    async generateCompactionSummary() {
      return { ok: false as const, error: 'Not needed by this smoke test.' }
    },
    async repairPattern(message: string) {
      studio.repairMessages.push(message)
      const fixed = studio.repairs.shift()
      if (!fixed) throw new Error('The test did not queue a repair.')
      return `\`\`\`js\n${fixed}\n\`\`\``
    },
  }),
}))

vi.mock('#/lib/patterns', () => ({
  loadSessionPattern: () => null,
  removePattern: () => true,
  saveSessionPattern: () => undefined,
  uniquePatternTitle: (title: string) => title,
  upsertPattern: () => true,
  usePatterns: () => [],
}))

vi.mock('@purple/ui/pattern-editor', async () => {
  const React = await import('react')
  return {
    PatternEditor(props: {
      code: string
      onCodeChange(code: string): void
      onEvaluate(): void
    }) {
      return React.createElement('textarea', {
        'aria-label': 'Pattern code',
        value: props.code,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          props.onCodeChange(event.currentTarget.value),
        onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            props.onEvaluate()
          }
        },
      })
    },
  }
})

vi.mock('@purple/ui/use-playback', async () => {
  const React = await import('react')

  function settledSnapshot(
    result: TestPlaybackResult,
    code: string,
    options: TestPlaybackOptions,
  ): TestPlaybackSnapshot | null {
    if (result.ok) {
      return { playbackState: 'playing', error: null, activeCode: code, activeRanges: [] }
    }
    if (result.kind === 'cancelled') return null
    return options.reportEvaluationError === false && result.kind === 'evaluation'
      ? { playbackState: 'stopped', error: null, activeCode: '', activeRanges: [] }
      : { playbackState: 'error', error: result.error, activeCode: '', activeRanges: [] }
  }

  return {
    usePlayback() {
      const [snapshot, setSnapshot] = React.useState<TestPlaybackSnapshot>({
        playbackState: 'stopped',
        error: null as string | null,
        activeCode: '',
        activeRanges: [] as readonly (readonly [number, number])[],
      })
      const snapshotRef = React.useRef(snapshot)
      const operationRef = React.useRef(0)
      const stopTokenRef = React.useRef(0)
      snapshotRef.current = snapshot
      studio.activeCode = snapshot.activeCode

      const prepareAudio = React.useCallback(async () => {
        studio.prepareAudioCalls++
        return { ok: true as const }
      }, [])

      const play = React.useCallback(async (
        code: string,
        options: TestPlaybackOptions = {},
      ) => {
        studio.playCalls.push(code)
        const operation = ++operationRef.current
        setSnapshot({ playbackState: 'loading', error: null, activeCode: '', activeRanges: [] })
        const queued = studio.playResults.shift()
        const result = await Promise.resolve(queued ?? { ok: true as const }) as TestPlaybackResult
        if (operation !== operationRef.current) return { ok: false as const, kind: 'cancelled' as const }
        const settled = settledSnapshot(result, code, options)
        if (settled !== null) setSnapshot(settled)
        return result
      }, [])

      const transition = React.useCallback(async (
        code: string,
        _cycles: number,
        options: TestPlaybackOptions = {},
      ) => {
        studio.transitionCalls.push(code)
        const previous = snapshotRef.current.activeCode
        const operation = ++operationRef.current
        setSnapshot((current) => ({ ...current, playbackState: 'transitioning', error: null }))
        const queued = studio.transitionResults.shift()
        const result = await Promise.resolve(queued ?? { ok: true as const }) as TestPlaybackResult
        if (operation !== operationRef.current) return { ok: false as const, kind: 'cancelled' as const }
        if (!result.ok && result.kind === 'evaluation' && 'source' in result && result.source === 'transition') {
          setSnapshot({
            playbackState: 'playing',
            error: options.reportEvaluationError === false ? null : result.error,
            activeCode: previous,
            activeRanges: [],
          })
        } else {
          const settled = settledSnapshot(result, code, options)
          if (settled !== null) setSnapshot(settled)
        }
        return result
      }, [])

      const stop = React.useCallback(() => {
        studio.stopCalls++
        stopTokenRef.current++
        operationRef.current++
        setSnapshot({ playbackState: 'stopped', error: null, activeCode: '', activeRanges: [] })
      }, [])

      const validatePattern = React.useCallback(async (code: string) => {
        studio.validationCalls.push(code)
        return studio.validationResults.get(code)?.shift() ?? []
      }, [])

      return {
        ...snapshot,
        prepareAudio,
        isAudioReady: () => true,
        play,
        transition,
        stop,
        getStopToken: () => stopTokenRef.current,
        validatePattern,
      }
    },
  }
})

beforeEach(() => {
  studio.generations.length = 0
  studio.repairs.length = 0
  studio.repairMessages.length = 0
  studio.streamMessages.length = 0
  studio.validationCalls.length = 0
  studio.validationResults.clear()
  studio.playCalls.length = 0
  studio.playResults.length = 0
  studio.transitionCalls.length = 0
  studio.transitionResults.length = 0
  studio.prepareAudioCalls = 0
  studio.stopCalls = 0
  studio.activeCode = ''
})

afterEach(() => {
  cleanup()
})

async function sendPrompt(prompt: string) {
  const user = userEvent.setup()
  await user.clear(screen.getByLabelText('Describe the music'))
  await user.type(screen.getByLabelText('Describe the music'), prompt)
  await user.click(screen.getByRole('button', { name: 'SEND' }))
}

async function startAndStageRevision() {
  studio.generations.push(FIRST_PATTERN, SECOND_PATTERN)
  render(<PurpleStudio />)

  await sendPrompt('Start a beat')
  await waitFor(() => expect(studio.activeCode).toBe(FIRST_PATTERN))

  await sendPrompt('Make the hats faster')
  await screen.findByRole('button', { name: 'XFADE' })
}

describe('Purple studio browser flow', () => {
  it('plays the first generation and exposes a one-shot XFADE for a revision', async () => {
    await startAndStageRevision()

    expect(studio.prepareAudioCalls).toBe(2)
    expect(studio.playCalls).toEqual([FIRST_PATTERN])
    expect(studio.validationCalls).toContain(FIRST_PATTERN)
    expect(studio.validationCalls).toContain(SECOND_PATTERN)
    expect(studio.transitionCalls).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'XFADE' }))

    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN))
    expect(studio.transitionCalls).toEqual([SECOND_PATTERN])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'XFADE' })).toBeNull())
  })

  it('repairs a candidate failure without exposing the evaluator error', async () => {
    studio.transitionResults.push(
      {
        ok: false,
        kind: 'evaluation',
        error: 'candidate-safe-interpreter-detail',
        source: 'candidate',
      },
      { ok: true },
    )
    studio.repairs.push(FIXED_PATTERN)
    await startAndStageRevision()

    await userEvent.click(screen.getByRole('button', { name: 'XFADE' }))

    await waitFor(() => expect(studio.activeCode).toBe(FIXED_PATTERN))
    expect(studio.transitionCalls).toEqual([SECOND_PATTERN, FIXED_PATTERN])
    expect(studio.repairMessages).toHaveLength(1)
    expect(studio.repairMessages[0]).toContain('candidate-safe-interpreter-detail')
    expect(document.body.textContent).not.toContain('candidate-safe-interpreter-detail')
  })

  it('keeps transition-wrapper failures out of the Gemini repair loop', async () => {
    studio.transitionResults.push({
      ok: false,
      kind: 'evaluation',
      error: 'internal-transition-wrapper-detail',
      source: 'transition',
    })
    await startAndStageRevision()

    await userEvent.click(screen.getByRole('button', { name: 'XFADE' }))

    await screen.findByText(
      'The crossfade could not complete. Use PLAY to resume if playback stopped.',
    )
    expect(studio.repairMessages).toEqual([])
    expect(document.body.textContent).not.toContain('internal-transition-wrapper-detail')
  })
})

describe('generated revision hot swap', () => {
  it('replaces a playing broken predecessor after validation repairs it', async () => {
    const replace = vi.fn(async () => ({ ok: true as const }))
    const requestFix = vi.fn(async () => FIXED_PATTERN)
    const onCodeChange = vi.fn()
    const hook = renderHook(() =>
      useGeneratedPattern({
        validatePattern: async (code) =>
          code === FIRST_PATTERN
            ? [{ kind: 'evaluation' as const, error: 'broken predecessor' }]
            : [],
        requestFix,
        onCodeChange,
        playingRevision: {
          getPlayingCode: () => FIRST_PATTERN,
          replace,
        },
        getStopToken: () => 0,
      }),
    )

    await act(async () => hook.result.current.adopt(FIRST_PATTERN, 'Start a beat'))
    let outcome: Awaited<ReturnType<typeof hook.result.current.validate>> | undefined
    await act(async () => {
      outcome = await hook.result.current.validate(FIRST_PATTERN)
    })

    expect(outcome?.code).toBe(FIXED_PATTERN)
    expect(requestFix).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledExactlyOnceWith(FIXED_PATTERN)
    expect(onCodeChange).toHaveBeenLastCalledWith(FIXED_PATTERN)
  })
})
