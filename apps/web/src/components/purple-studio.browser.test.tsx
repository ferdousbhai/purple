/* oxlint-disable anti-slop/no-module-mocking -- The browser flow keeps network, storage, editor, and audio boundaries deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted mutable fixtures need explicit collection and result types. */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PurpleStudio } from './purple-studio'
import { SHOWCASE_PATTERNS } from '@purple/core/recipes'
import { useGeneratedPattern } from '@purple/ui/use-generated-pattern'
import type { TransitionResult } from '@purple/ui/use-playback'
import type { EvalResult, PlaybackState } from '@purple/core/types'

const FIRST_PATTERN = 's("bd sd")'
const SECOND_PATTERN = 's("hh*8")'
const FIXED_PATTERN = 's("hh*4").gain(0.5)'
const HAND_EDITED_PATTERN = 's("cp*2")'
const NEXT_SUGGESTIONS = [
  { label: 'Drift to dub', prompt: 'Continue as spacious dub' },
  { label: 'Lift the pulse', prompt: 'Continue as bright house' },
  { label: 'Melt to ambient', prompt: 'Continue as soft ambient' },
]

// The real playback unions, so the mock cannot drift from the contract.
interface TestPlaybackSnapshot {
  playbackState: PlaybackState
  error: string | null
  activeCode: string
}

type TestPlaybackResult = EvalResult | TransitionResult

interface TestPlaybackOptions {
  reportEvaluationError?: boolean
}

const studio = vi.hoisted(() => ({
  generations: [] as string[],
  repairs: [] as string[],
  repairGates: [] as Promise<void>[],
  patternCompletionGates: [] as Promise<void>[],
  metadataGates: [] as Promise<void>[],
  repairMessages: [] as string[],
  repairAbortCalls: 0,
  streamMessages: [] as unknown[],
  validationCalls: [] as string[],
  validationGates: [] as Promise<void>[],
  validationResults: new Map<string, unknown[][]>(),
  playCalls: [] as string[],
  playResults: [] as unknown[],
  transitionCalls: [] as string[],
  transitionResults: [] as unknown[],
  prepareValidationCalls: 0,
  stopCalls: 0,
  clearChatCalls: 0,
  saveChatCalls: 0,
  savedChatStates: [] as Array<{
    messages: Array<{ role: string; content: string }>
  }>,
  activeCode: '',
  savedPatterns: [] as Array<{
    id: string
    title: string
    code: string
    prompt?: string
    createdAt: number
    updatedAt: number
  }>,
  savedSessionPatterns: [] as Array<{
    code: string
    customTitle: string | null
    sourcePrompt?: string
  }>,
  restoredPattern: null as {
    code: string
    customTitle: string | null
    sourcePrompt?: string
  } | null,
}))

vi.mock('#/lib/byok', () => ({
  clearByokChat: () => {
    studio.clearChatCalls++
    return true
  },
  getByokKey: () => 'browser-test-key',
  loadByokChat: () => null,
  saveByokChat: (state: { messages: Array<{ role: string; content: string }> }) => {
    studio.saveChatCalls++
    studio.savedChatStates.push(state)
    return true
  },
  setByokKey: () => undefined,
  createByokBackend: () => ({
    async stream(messages: unknown[], callbacks: {
      onPatternDelta(delta: string): void
      onPatternComplete(pattern: string): void
    }) {
      studio.streamMessages.push(messages)
      const pattern = studio.generations.shift()
      if (!pattern) throw new Error('The test did not queue a generation.')
      callbacks.onPatternDelta(pattern)
      await studio.patternCompletionGates.shift()
      callbacks.onPatternComplete(pattern)
      await studio.metadataGates.shift()
      return {
        turn: {
          pattern,
          title: 'Browser smoke pattern',
          suggestions: NEXT_SUGGESTIONS,
          explanation: 'Here is the pattern.',
        },
        promptTokens: 20,
      }
    },
    async abortStream() {},
    abortRepair() {
      studio.repairAbortCalls++
    },
    async generateCompactionSummary() {
      return { ok: false as const, error: 'Not needed by this smoke test.' }
    },
    async repairPattern(message: string) {
      studio.repairMessages.push(message)
      const fixed = studio.repairs.shift()
      if (!fixed) throw new Error('The test did not queue a repair.')
      await studio.repairGates.shift()
      return fixed
    },
  }),
}))

vi.mock('#/lib/byok-storage', () => ({
  clearByokChat: () => {
    studio.clearChatCalls++
    return true
  },
  getByokKey: () => 'browser-test-key',
  setByokKey: () => undefined,
}))

vi.mock('#/lib/patterns', () => ({
  loadSessionPattern: () => studio.restoredPattern,
  removePattern: () => true,
  saveSessionPattern: (pattern: {
    code: string
    customTitle: string | null
    sourcePrompt?: string
  }) => {
    studio.savedSessionPatterns.push(pattern)
  },
  uniquePatternTitle: (title: string) => title,
  upsertPattern: () => true,
  usePatterns: () => studio.savedPatterns,
}))

vi.mock('@purple/ui/pattern-editor', async () => {
  const React = await import('react')
  return {
    PatternEditor(props: {
      code: string
      onCodeChange(code: string): void
      onEvaluate(): void
      readOnly?: boolean
    }) {
      return React.createElement('textarea', {
        'aria-label': 'Pattern code',
        value: props.code,
        readOnly: props.readOnly,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          props.onCodeChange(event.currentTarget.value),
        onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (
            !props.readOnly &&
            (event.ctrlKey || event.metaKey) &&
            event.key === 'Enter'
          ) {
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
      return { playbackState: 'playing', error: null, activeCode: code }
    }
    if (result.kind === 'cancelled') return null
    return options.reportEvaluationError === false && result.kind === 'evaluation'
      ? { playbackState: 'stopped', error: null, activeCode: '' }
      : { playbackState: 'error', error: result.error, activeCode: '' }
  }

  return {
    usePlayback() {
      const [snapshot, setSnapshot] = React.useState<TestPlaybackSnapshot>({
        playbackState: 'stopped',
        error: null as string | null,
        activeCode: '',
      })
      const snapshotRef = React.useRef(snapshot)
      const operationRef = React.useRef(0)
      const stopTokenRef = React.useRef(0)
      snapshotRef.current = snapshot
      studio.activeCode = snapshot.activeCode

      const prepareValidation = React.useCallback(async () => {
        studio.prepareValidationCalls++
        return { ok: true as const }
      }, [])

      const play = React.useCallback(async (
        code: string,
        options: TestPlaybackOptions = {},
      ) => {
        studio.playCalls.push(code)
        const operation = ++operationRef.current
        setSnapshot({ playbackState: 'loading', error: null, activeCode: '' })
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
        setSnapshot({ playbackState: 'stopped', error: null, activeCode: '' })
      }, [])

      const validatePattern = React.useCallback(async (code: string) => {
        studio.validationCalls.push(code)
        await studio.validationGates.shift()
        return studio.validationResults.get(code)?.shift() ?? []
      }, [])

      return {
        ...snapshot,
        prepareValidation,
        play,
        transition,
        stop,
        getStopToken: () => stopTokenRef.current,
        validatePattern,
        getActiveSourceRanges: () => [],
        getOutputAnalyser: () => null,
      }
    },
  }
})

beforeEach(() => {
  studio.generations.length = 0
  studio.repairs.length = 0
  studio.repairGates.length = 0
  studio.patternCompletionGates.length = 0
  studio.metadataGates.length = 0
  studio.repairMessages.length = 0
  studio.repairAbortCalls = 0
  studio.streamMessages.length = 0
  studio.validationCalls.length = 0
  studio.validationGates.length = 0
  studio.validationResults.clear()
  studio.playCalls.length = 0
  studio.playResults.length = 0
  studio.transitionCalls.length = 0
  studio.transitionResults.length = 0
  studio.prepareValidationCalls = 0
  studio.stopCalls = 0
  studio.clearChatCalls = 0
  studio.saveChatCalls = 0
  studio.savedChatStates.length = 0
  studio.activeCode = ''
  studio.savedPatterns.length = 0
  studio.savedSessionPatterns.length = 0
  studio.restoredPattern = null
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function sendPrompt(prompt: string, user = userEvent.setup()) {
  const input = await screen.findByLabelText('Describe the music')
  await user.clear(input)
  await user.type(input, prompt)
  await user.click(screen.getByRole('button', { name: 'SEND' }))
}

async function playGeneratedPattern(expectedActiveCode: string) {
  await screen.findByRole('button', { name: 'Drift to dub' })
  expect(studio.playCalls).toEqual([])
  await userEvent.click(screen.getByRole('button', { name: /PLAY/ }))
  await waitFor(() => expect(studio.activeCode).toBe(expectedActiveCode))
}

async function renderGeneratedPattern(pattern = FIRST_PATTERN) {
  studio.generations.push(pattern)
  render(<PurpleStudio />)
  await sendPrompt('Start a beat')
  await waitFor(() =>
    expect(screen.getByLabelText('Pattern code')).toHaveValue(pattern),
  )
}

async function unmountComposerAndExpectPattern(
  editor: HTMLElement,
  expectedPattern: string,
) {
  await userEvent.click(screen.getByRole('button', { name: 'KEY ✓' }))
  await waitFor(() => expect(editor).toHaveValue(expectedPattern))
  expect(editor).not.toHaveAttribute('readonly')
}

async function startMetadataTailGeneration() {
  const metadata = deferred()
  studio.generations.push(FIRST_PATTERN)
  studio.metadataGates.push(metadata.promise)
  render(<PurpleStudio />)

  const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
  const originalPattern = editor.value
  const originalTitle = (screen.getByLabelText('Pattern title') as HTMLInputElement).value
  await waitFor(() => expect(studio.savedSessionPatterns.length).toBeGreaterThan(0))
  await sendPrompt('Start a beat')
  await waitFor(() => expect(editor).toHaveValue(FIRST_PATTERN))
  await waitFor(() => expect(editor).not.toHaveAttribute('readonly'))
  return { editor, metadata, originalPattern, originalTitle }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function startAndStageRevision() {
  studio.generations.push(FIRST_PATTERN, SECOND_PATTERN)
  render(<PurpleStudio />)

  await sendPrompt('Start a beat')
  await waitFor(() =>
    expect(screen.getByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN),
  )
  expect(studio.activeCode).toBe('')
  await playGeneratedPattern(FIRST_PATTERN)

  await sendPrompt('Make the hats faster')
  await screen.findByRole('button', { name: 'XFADE' })
}

async function startDelayedPlayRepair(error: string) {
  const repair = deferred()
  studio.generations.push(FIRST_PATTERN)
  studio.playResults.push({ ok: false, kind: 'evaluation', error })
  studio.repairs.push(FIXED_PATTERN)
  studio.repairGates.push(repair.promise)
  render(<PurpleStudio />)

  await sendPrompt('Start a beat')
  await screen.findByRole('button', { name: 'Drift to dub' })
  await userEvent.click(screen.getByRole('button', { name: /PLAY/ }))
  await waitFor(() => expect(studio.repairMessages).toHaveLength(1))
  return repair
}

describe('Purple studio browser flow', () => {
  it('opens a fresh session on a titled showcase without autoplaying it', async () => {
    render(<PurpleStudio />)

    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const showcase = SHOWCASE_PATTERNS.find(({ code }) => code === editor.value)
    if (!showcase) throw new Error('The editor did not receive a showcase pattern.')

    expect(screen.getByLabelText('Pattern title')).toHaveValue(showcase.title)
    expect(studio.prepareValidationCalls).toBe(0)
    expect(studio.playCalls).toEqual([])
  })

  it('restores an existing session instead of replacing it with a showcase', async () => {
    studio.restoredPattern = {
      code: FIRST_PATTERN,
      customTitle: 'Saved Session',
      sourcePrompt: 'the visitor was already making this',
    }
    render(<PurpleStudio />)

    expect(await screen.findByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN)
    expect(screen.getByLabelText('Pattern title')).toHaveValue('Saved Session')
  })

  it('previews the pattern and repairs it while turn metadata is still streaming', async () => {
    const patternCompletion = deferred()
    const metadata = deferred()
    const repair = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.repairs.push(FIXED_PATTERN)
    studio.patternCompletionGates.push(patternCompletion.promise)
    studio.metadataGates.push(metadata.promise)
    studio.repairGates.push(repair.promise)
    studio.validationResults.set(FIRST_PATTERN, [
      [{ kind: 'evaluation', error: 'early validation failure' }],
    ])
    studio.validationResults.set(FIXED_PATTERN, [[]])
    render(<PurpleStudio />)

    await sendPrompt('Start a broken beat')

    await waitFor(() =>
      expect(screen.getByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN),
    )
    expect(screen.getByLabelText('Pattern code')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Pattern title')).toBeDisabled()
    expect(screen.getByRole('button', { name: /SAVE/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'EXPORT' })).toBeDisabled()
    expect(studio.validationCalls).toEqual([])

    patternCompletion.resolve()
    await waitFor(() => expect(studio.repairMessages).toHaveLength(1))
    expect(screen.getByLabelText('Pattern code')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /PLAY/ })).toBeDisabled()

    repair.resolve()
    await waitFor(() =>
      expect(screen.getByLabelText('Pattern code')).toHaveValue(FIXED_PATTERN),
    )
    expect(screen.getByLabelText('Pattern code')).not.toHaveAttribute('readonly')
    expect(screen.getByLabelText('Pattern title')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /SAVE/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'EXPORT' })).not.toBeDisabled()
    expect(studio.playCalls).toEqual([])

    metadata.resolve()
    await waitFor(() =>
      expect(screen.getByLabelText('Pattern code')).toHaveValue(FIXED_PATTERN),
    )
    expect(studio.activeCode).toBe('')
    expect(studio.playCalls).toEqual([])
    expect(screen.getByRole('button', { name: 'Drift to dub' })).toBeVisible()
    expect(studio.streamMessages).toHaveLength(1)
    expect(studio.repairMessages).toHaveLength(1)
  })

  it('discards a partial preview when the composer unmounts', async () => {
    const patternCompletion = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.patternCompletionGates.push(patternCompletion.promise)
    render(<PurpleStudio />)

    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const originalPattern = editor.value
    const originalTitle = (screen.getByLabelText('Pattern title') as HTMLInputElement).value
    await sendPrompt('Start a beat')
    await waitFor(() => expect(editor).toHaveValue(FIRST_PATTERN))
    expect(editor).toHaveAttribute('readonly')

    await unmountComposerAndExpectPattern(editor, originalPattern)
    expect(screen.getByLabelText('Pattern title')).toHaveValue(originalTitle)
  })

  it('disables library pattern selection while generation owns the editor', async () => {
    const patternCompletion = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.patternCompletionGates.push(patternCompletion.promise)
    studio.savedPatterns.push({
      id: 'saved-pattern',
      title: 'Saved Pattern',
      code: SECOND_PATTERN,
      createdAt: 1,
      updatedAt: 1,
    })
    render(<PurpleStudio />)

    await sendPrompt('Start a beat')
    await waitFor(() =>
      expect(screen.getByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN),
    )
    await userEvent.click(screen.getByRole('button', { name: 'LIBRARY' }))

    expect(screen.getByRole('button', { name: 'Saved Pattern' })).toBeDisabled()
  })

  it('restores the durable pattern when metadata-tail generation is cancelled', async () => {
    const { editor, originalPattern, originalTitle } =
      await startMetadataTailGeneration()

    expect(studio.savedSessionPatterns.at(-1)?.code).toBe(originalPattern)
    await unmountComposerAndExpectPattern(editor, originalPattern)
    expect(screen.getByLabelText('Pattern title')).toHaveValue(originalTitle)
    expect(studio.savedSessionPatterns.at(-1)?.code).toBe(originalPattern)
  })

  it('preserves a hand edit when metadata-tail generation is cancelled', async () => {
    const { editor } = await startMetadataTailGeneration()

    await userEvent.clear(editor)
    await userEvent.type(editor, HAND_EDITED_PATTERN)
    await unmountComposerAndExpectPattern(editor, HAND_EDITED_PATTERN)

    await waitFor(() =>
      expect(studio.savedSessionPatterns.at(-1)?.code).toBe(HAND_EDITED_PATTERN),
    )
  })

  it('preserves a library selection when metadata-tail generation is cancelled', async () => {
    studio.savedPatterns.push({
      id: 'saved-pattern',
      title: 'Saved Pattern',
      code: SECOND_PATTERN,
      createdAt: 1,
      updatedAt: 1,
    })
    const { editor } = await startMetadataTailGeneration()

    await userEvent.click(screen.getByRole('button', { name: 'LIBRARY' }))
    await userEvent.click(screen.getByRole('button', { name: 'Saved Pattern' }))
    expect(editor).toHaveValue(SECOND_PATTERN)
    await unmountComposerAndExpectPattern(editor, SECOND_PATTERN)

    await waitFor(() =>
      expect(studio.savedSessionPatterns.at(-1)?.code).toBe(SECOND_PATTERN),
    )
  })

  it('restores the durable pattern when validation-tail generation is cancelled', async () => {
    const validation = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.validationGates.push(validation.promise)
    render(<PurpleStudio />)

    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const originalPattern = editor.value
    await waitFor(() => expect(studio.savedSessionPatterns.length).toBeGreaterThan(0))
    await sendPrompt('Start a beat')
    await waitFor(() => expect(editor).toHaveValue(FIRST_PATTERN))
    expect(editor).toHaveAttribute('readonly')

    await unmountComposerAndExpectPattern(editor, originalPattern)
    expect(studio.savedSessionPatterns.at(-1)?.code).toBe(originalPattern)
    validation.resolve()
  })

  it('preserves a title edited while metadata is still streaming', async () => {
    const metadata = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.metadataGates.push(metadata.promise)
    render(<PurpleStudio />)

    await sendPrompt('Start a beat')
    const editor = await screen.findByLabelText('Pattern code')
    await waitFor(() => expect(editor).not.toHaveAttribute('readonly'))

    const title = screen.getByLabelText('Pattern title')
    await userEvent.clear(title)
    await userEvent.type(title, 'My hand title')
    metadata.resolve()

    await screen.findByRole('button', { name: 'Drift to dub' })
    expect(title).toHaveValue('My hand title')
  })

  it('clears the session and brings it back through UNDO', async () => {
    await renderGeneratedPattern()

    await userEvent.click(
      screen.getByRole('button', { name: 'Clear session and start over' }),
    )
    await screen.findByText('What do you want to hear?')

    expect(screen.queryByText('Start a beat')).toBeNull()
    expect(studio.clearChatCalls).toBe(1)
    expect(screen.getByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN)

    const savesBeforeUndo = studio.saveChatCalls
    await userEvent.click(screen.getByRole('button', { name: 'UNDO' }))

    await screen.findByText('Start a beat')
    expect(screen.queryByText('What do you want to hear?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'UNDO' })).toBeNull()
    expect(studio.saveChatCalls).toBeGreaterThan(savesBeforeUndo)
  })

  it('waits for PLAY and exposes an explicit XFADE for a revision', async () => {
    await startAndStageRevision()

    expect(studio.prepareValidationCalls).toBe(2)
    expect(studio.playCalls).toEqual([FIRST_PATTERN])
    expect(studio.validationCalls).toContain(FIRST_PATTERN)
    expect(studio.validationCalls).toContain(SECOND_PATTERN)
    expect(studio.transitionCalls).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'XFADE' }))

    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN))
    expect(studio.transitionCalls).toEqual([SECOND_PATTERN])
  })

  it('repairs an untouched generated pattern when explicit PLAY fails', async () => {
    studio.generations.push(FIRST_PATTERN)
    studio.playResults.push(
      {
        ok: false,
        kind: 'evaluation',
        error: 'play-time-evaluation-detail',
      },
      { ok: true },
    )
    studio.repairs.push(FIXED_PATTERN)
    render(<PurpleStudio />)

    await sendPrompt('Start a beat')
    await playGeneratedPattern(FIXED_PATTERN)
    expect(studio.playCalls).toEqual([FIRST_PATTERN, FIXED_PATTERN])
    expect(studio.repairMessages).toHaveLength(1)
    expect(studio.repairMessages[0]).toContain('play-time-evaluation-detail')
  })

  it('commits a PLAY repair that finishes before streamed metadata', async () => {
    const metadata = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.metadataGates.push(metadata.promise)
    studio.playResults.push(
      {
        ok: false,
        kind: 'evaluation',
        error: 'repair-before-metadata',
      },
      { ok: true },
    )
    studio.repairs.push(FIXED_PATTERN)
    render(<PurpleStudio />)

    await sendPrompt('Start a beat')
    const editor = await screen.findByLabelText('Pattern code')
    await waitFor(() => expect(editor).not.toHaveAttribute('readonly'))
    await userEvent.click(screen.getByRole('button', { name: /PLAY/ }))
    await waitFor(() => expect(studio.activeCode).toBe(FIXED_PATTERN))

    metadata.resolve()
    await screen.findByRole('button', { name: 'Drift to dub' })
    const assistant = studio.savedChatStates.at(-1)?.messages.at(-1)
    expect(assistant?.content).toContain(FIXED_PATTERN)
    expect(assistant?.content).not.toContain(FIRST_PATTERN)
  })

  it('does not let a delayed PLAY repair overwrite a hand edit', async () => {
    const repair = await startDelayedPlayRepair('delayed-play-repair')

    expect(screen.getByRole('button', { name: 'SEND' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /PLAY/ }))
    expect(studio.repairMessages).toHaveLength(1)

    const editor = screen.getByLabelText('Pattern code')
    await userEvent.clear(editor)
    await userEvent.type(editor, HAND_EDITED_PATTERN)
    repair.resolve()

    await waitFor(() => expect(editor).toHaveValue(HAND_EDITED_PATTERN))
    expect(studio.playCalls).toEqual([FIRST_PATTERN])
  })

  it('does not apply a delayed PLAY repair after the composer unmounts', async () => {
    const repair = await startDelayedPlayRepair('unmounted-play-repair')
    await userEvent.click(screen.getByRole('button', { name: 'KEY ✓' }))
    repair.resolve()

    const editor = screen.getByLabelText('Pattern code')
    await waitFor(() => expect(editor).toHaveValue(FIRST_PATTERN))
    expect(studio.playCalls).toEqual([FIRST_PATTERN])
    expect(studio.repairAbortCalls).toBeGreaterThan(0)
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

    await act(async () => hook.result.current.adopt(FIRST_PATTERN))
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
