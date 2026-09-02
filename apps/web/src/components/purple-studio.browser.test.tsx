/* oxlint-disable anti-slop/no-module-mocking -- The browser flow keeps network, storage, editor, and audio boundaries deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted mutable fixtures need explicit collection and result types. */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '#/styles.css'
import { PurpleStudio } from './purple-studio'
import { SHOWCASE_PATTERNS } from '@purple/core/recipes'
import { CONTINUE_PATTERN_ACTION } from '@purple/core/progression'
import { useGeneratedPattern } from '@purple/ui/use-generated-pattern'
import type { TransitionResult } from '@purple/ui/use-playback'
import type { EvalResult, PlaybackState } from '@purple/core/types'

const FIRST_PATTERN = 's("bd sd")'
const SECOND_PATTERN = 's("hh*8")'
const FIXED_PATTERN = 's("hh*4").gain(0.5)'
const HAND_EDITED_PATTERN = 's("cp*2")'
const PLANNED_CYCLES = 1_856
const NEXT_ACTION = 'Add an evolving granular piano texture drifting in and out of the high register while deepening the resonance of the drone pads'
const NEXT_SUGGESTIONS = [
  { label: 'Drift to dub', prompt: 'Continue as spacious dub' },
  { label: 'Lift the pulse', prompt: 'Continue as bright house' },
  { label: 'Melt to ambient', prompt: 'Continue as soft ambient' },
]

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
  transitionCycleCalls: [] as number[],
  transitionResults: [] as unknown[],
  progressionWaitCalls: [] as number[],
  progressionWaitGates: [] as Promise<void>[],
  reportProgressionWait: null as
    | ((remainingCycles: number, cyclesPerSecond: number) => void)
    | null,
  prepareValidationCalls: 0,
  stopCalls: 0,
  storedKey: 'browser-test-key' as string | null,
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
    shareId?: string
    createdAt: number
    updatedAt: number
  }>,
  upsertedPatterns: [] as Array<{
    id: string
    title: string
    code: string
    shareId?: string
  }>,
  savedSessionPatterns: [] as Array<{
    code: string
    customTitle: string | null
    sourcePrompt?: string
    shareId?: string
  }>,
  restoredPattern: null as {
    code: string
    customTitle: string | null
    sourcePrompt?: string
    shareId?: string
  } | null,
  restoredChat: null as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    artifact: null
    coveredCount: number
  } | null,
}))

vi.mock('#/lib/byok', () => ({
  clearByokChat: () => {
    studio.clearChatCalls++
    return true
  },
  getByokKey: () => studio.storedKey,
  loadByokChat: () => studio.restoredChat,
  saveByokChat: (state: { messages: Array<{ role: string; content: string }> }) => {
    studio.saveChatCalls++
    studio.savedChatStates.push(state)
    return true
  },
  setByokKey: (key: string | null) => {
    studio.storedKey = key?.trim() || null
  },
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
          progression: {
            afterCycles: PLANNED_CYCLES,
            nextAction: NEXT_ACTION,
          },
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
  getByokKey: () => studio.storedKey,
  setByokKey: (key: string | null) => {
    studio.storedKey = key?.trim() || null
  },
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
  sharedLibraryId: (id: string) => `shared:${id}`,
  uniquePatternTitle: (title: string) => title,
  upsertPattern: (pattern: {
    id: string
    title: string
    code: string
    prompt?: string
    shareId?: string
    createdAt: number
    updatedAt: number
  }) => {
    studio.upsertedPatterns.push(pattern)
    studio.savedPatterns = [
      ...studio.savedPatterns.filter((saved) => saved.id !== pattern.id),
      pattern,
    ]
    return true
  },
  usePatterns: () => studio.savedPatterns,
}))

vi.mock('./share-dialog', async () => {
  const React = await import('react')
  return {
    ShareDialog(props: { onShared(id: string, title: string): void }) {
      return React.createElement(
        'button',
        { onClick: () => props.onShared('New_123-xYz9', 'Published Pattern') },
        'PUBLISH TEST PATTERN',
      )
    },
  }
})

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
        cycles: number,
        options: TestPlaybackOptions = {},
      ) => {
        studio.transitionCalls.push(code)
        studio.transitionCycleCalls.push(cycles)
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

      const waitForCycles = React.useCallback((
        cycles: number,
        signal?: AbortSignal,
        onProgress?: (remainingCycles: number, cyclesPerSecond: number) => void,
      ): Promise<EvalResult> => {
        studio.progressionWaitCalls.push(cycles)
        studio.reportProgressionWait = onProgress ?? null
        onProgress?.(cycles, 0.5)
        const gate = studio.progressionWaitGates.shift()
        if (!gate) {
          return Promise.resolve({ ok: false, kind: 'cancelled' })
        }
        return new Promise((resolve) => {
          let settled = false
          const finish = (result: EvalResult) => {
            if (settled) return
            settled = true
            signal?.removeEventListener('abort', cancel)
            resolve(result)
          }
          const cancel = () => finish({ ok: false, kind: 'cancelled' })
          if (signal?.aborted) {
            cancel()
            return
          }
          signal?.addEventListener('abort', cancel, { once: true })
          void gate.then(() => finish({ ok: true }))
        })
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
        waitForCycles,
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
  studio.transitionCycleCalls.length = 0
  studio.transitionResults.length = 0
  studio.progressionWaitCalls.length = 0
  studio.progressionWaitGates.length = 0
  studio.reportProgressionWait = null
  studio.prepareValidationCalls = 0
  studio.stopCalls = 0
  studio.storedKey = 'browser-test-key'
  studio.clearChatCalls = 0
  studio.saveChatCalls = 0
  studio.savedChatStates.length = 0
  studio.activeCode = ''
  studio.savedPatterns.length = 0
  studio.upsertedPatterns.length = 0
  studio.savedSessionPatterns.length = 0
  studio.restoredPattern = null
  studio.restoredChat = null
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

function autoplayCheckbox() {
  return screen.getByLabelText(/Autoplay/) as HTMLInputElement
}

async function armAutoplay() {
  const playCallsBefore = studio.playCalls.length
  await userEvent.click(autoplayCheckbox())
  expect(autoplayCheckbox()).toBeChecked()
  expect(studio.playCalls).toHaveLength(playCallsBefore)
}

async function xfadeNow(expectedActiveCode: string) {
  await userEvent.click(screen.getByRole('button', { name: 'XFADE NOW' }))
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

function deferredResult<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitForProgressionWaits(count: number) {
  await waitFor(() =>
    expect(studio.progressionWaitCalls).toEqual(
      Array.from({ length: count }, () => PLANNED_CYCLES),
    ),
  )
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
  await screen.findByRole('button', { name: 'XFADE NOW' })
}

async function startModelPlannedRun() {
  const musicalWake = deferred()
  studio.generations.push(FIRST_PATTERN, SECOND_PATTERN)
  studio.progressionWaitGates.push(musicalWake.promise)
  render(<PurpleStudio />)

  await sendPrompt('Start a beat')
  await armAutoplay()
  await playGeneratedPattern(FIRST_PATTERN)
  await waitForProgressionWaits(1)
  return musicalWake
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

async function renderPlayingStudio() {
  const rendered = render(<PurpleStudio />)
  await screen.findByLabelText('Pattern code')
  await screen.findByLabelText('Describe the music')
  await userEvent.click(await screen.findByRole('button', { name: /PLAY/ }))
  await waitFor(() => expect(studio.activeCode).not.toBe(''))
  return rendered
}

function publicPattern(viewerVote: -1 | 0 | 1 = 0) {
  return {
    id: 'Abc_123-xYz9',
    title: 'Shared pattern',
    code: FIRST_PATTERN,
    createdAt: 1_700_000_000_000,
    likes: 4,
    dislikes: 1,
    score: 3,
    viewerVote,
  }
}

describe('Purple studio browser flow', () => {
  it('saves a pasted Gemini key and closes the key card immediately', async () => {
    studio.storedKey = null
    const user = userEvent.setup()
    render(<PurpleStudio />)
    await screen.findByLabelText('Pattern code')

    const keyInput = screen.getByLabelText('Gemini API key')
    keyInput.focus()
    await act(async () => {
      await user.paste('  AIza-pasted-browser-key  ')
    })

    expect(studio.storedKey).toBe('AIza-pasted-browser-key')
    expect(screen.queryByLabelText('Gemini API key')).toBeNull()
    expect(screen.getByRole('button', { name: 'KEY ✓' })).toBeVisible()
  })

  it('does not send a prompt when Enter confirms IME composition', async () => {
    render(<PurpleStudio />)
    const input = await screen.findByLabelText('Describe the music')
    await userEvent.type(input, 'ゆっくりした音楽')

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(studio.streamMessages).toEqual([])
    expect(input).toHaveValue('ゆっくりした音楽')
  })

  it('keeps the public patterns route visible in the playing phone topbar', async () => {
    await act(async () => page.viewport(320, 568))
    try {
      const { container } = await renderPlayingStudio()

      expect(screen.getByRole('link', { name: 'PATTERNS' })).toBeVisible()
      const topbar = container.querySelector('.topbar')
      expect(topbar?.scrollWidth).toBeLessThanOrEqual(topbar?.clientWidth ?? 0)
    } finally {
      await act(async () => page.viewport(1280, 720))
    }
  })

  it('uses Save for the local library even when a public pattern was liked', async () => {
    render(<PurpleStudio sharedPattern={publicPattern(1)} />)

    expect(screen.queryByRole('button', { name: /LIKE/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'SAVE' }))
    expect(studio.upsertedPatterns).toEqual([
      expect.objectContaining({
        id: 'shared:Abc_123-xYz9',
        shareId: 'Abc_123-xYz9',
      }),
    ])
  })

  it('shows effect modifiers for a shared pattern before chat begins', async () => {
    render(<PurpleStudio sharedPattern={publicPattern()} />)

    expect(await screen.findByText('What do you want to hear?')).toBeVisible()
    expect(screen.getByText('EFFECT')).toBeVisible()
    expect(screen.getByRole('button', { name: '🎛️ Filter Sweep' })).toBeVisible()
  })

  it('disables Save and Share when the editor has no pattern', async () => {
    render(<PurpleStudio />)
    const editor = await screen.findByLabelText('Pattern code')

    expect(screen.getByText('EFFECT')).toBeVisible()

    await userEvent.clear(editor)

    expect(screen.getByRole('button', { name: 'SAVE' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SHARE' })).toBeDisabled()
    expect(screen.queryByText('EFFECT')).toBeNull()
  })

  it('adds the public identity to a locally saved pattern after sharing', async () => {
    const saved = {
      id: 'local-pattern',
      title: 'Saved Pattern',
      code: FIRST_PATTERN,
      prompt: 'Original prompt',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_123,
    }
    studio.restoredPattern = {
      code: FIRST_PATTERN,
      customTitle: saved.title,
      sourcePrompt: saved.prompt,
    }
    studio.savedPatterns = [saved]
    render(<PurpleStudio />)

    expect(await screen.findByRole('button', { name: 'SAVED' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'SHARE' }))
    await userEvent.click(await screen.findByRole('button', {
      name: 'PUBLISH TEST PATTERN',
    }))

    expect(studio.upsertedPatterns.at(-1)).toEqual({
      ...saved,
      title: 'Published Pattern',
      shareId: 'New_123-xYz9',
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'SAVED' })).toBeVisible())
    expect(studio.savedSessionPatterns.at(-1)).toMatchObject({
      shareId: 'New_123-xYz9',
    })
  })

  it('starts a shared pattern with fresh matching chat context', async () => {
    studio.restoredChat = {
      messages: [
        { role: 'user', content: 'Old unrelated request' },
        { role: 'assistant', content: `\`\`\`strudel\n${HAND_EDITED_PATTERN}\n\`\`\`` },
      ],
      artifact: null,
      coveredCount: 0,
    }
    studio.generations.push(SECOND_PATTERN)
    render(<PurpleStudio sharedPattern={publicPattern()} />)

    expect(await screen.findByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN)
    expect(screen.queryByText('Old unrelated request')).toBeNull()
    await waitFor(() => expect(studio.clearChatCalls).toBe(1))

    await sendPrompt('Change the shared rhythm')
    await screen.findByRole('button', { name: 'Drift to dub' })
    const request = studio.streamMessages[0] as Array<{ content: string }>
    expect(request.some(({ content }) => content.includes(FIRST_PATTERN))).toBe(true)
    expect(JSON.stringify(request)).not.toContain('Old unrelated request')
    expect(JSON.stringify(request)).not.toContain(HAND_EDITED_PATTERN)
  })

  it('puts the equalizer first and keeps feedback beside library and key', async () => {
    const { container } = await renderPlayingStudio()

    const actions = container.querySelector('.topbar-actions')
    const feedback = screen.getByRole('button', { name: 'FEEDBACK' })
    const library = screen.getByRole('button', { name: 'LIBRARY' })
    const key = screen.getByRole('button', { name: 'KEY ✓' })

    expect(actions?.firstElementChild).toHaveClass('eq-bars')
    expect(feedback.nextElementSibling).toBe(library)
    expect(library.nextElementSibling).toBe(key)
  })

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

  it('keeps the current pattern visible while checking and repairing a revision', async () => {
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

    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const originalPattern = editor.value
    await sendPrompt('Start a broken beat')

    expect(await screen.findByText('REVISING…')).toBeVisible()
    expect(editor).toHaveValue(originalPattern)
    expect(editor).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Pattern title')).toBeDisabled()
    expect(screen.getByRole('button', { name: /SAVE/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'EXPORT' })).toBeDisabled()
    expect(studio.validationCalls).toEqual([])

    patternCompletion.resolve()
    await waitFor(() => expect(studio.repairMessages).toHaveLength(1))
    expect(screen.getByText('CHECKING…')).toBeVisible()
    expect(editor).toHaveValue(originalPattern)
    expect(editor).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /PLAY/ })).toBeDisabled()

    repair.resolve()
    await waitFor(() =>
      expect(editor).toHaveValue(FIXED_PATTERN),
    )
    expect(screen.queryByText('CHECKING…')).toBeNull()
    expect(screen.getByText('FINISHING…')).toBeVisible()
    expect(editor).not.toHaveAttribute('readonly')
    expect(screen.getByLabelText('Pattern title')).toBeDisabled()
    expect(screen.getByRole('button', { name: /SAVE/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SHARE' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'EXPORT' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /PLAY/ })).toBeDisabled()
    expect(studio.playCalls).toEqual([])

    metadata.resolve()
    await screen.findByRole('button', { name: 'Drift to dub' })
    expect(screen.queryByText('FINISHING…')).toBeNull()
    expect(screen.getByLabelText('Pattern title')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /SAVE/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'SHARE' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'EXPORT' })).not.toBeDisabled()
    expect(studio.activeCode).toBe('')
    expect(studio.playCalls).toEqual([])
    expect(studio.streamMessages).toHaveLength(1)
    expect(studio.repairMessages).toHaveLength(1)
  })

  it('keeps the durable pattern when a streaming revision is unmounted', async () => {
    const patternCompletion = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.patternCompletionGates.push(patternCompletion.promise)
    render(<PurpleStudio />)

    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const originalPattern = editor.value
    const originalTitle = (screen.getByLabelText('Pattern title') as HTMLInputElement).value
    await sendPrompt('Start a beat')
    expect(await screen.findByText('REVISING…')).toBeVisible()
    expect(editor).toHaveValue(originalPattern)
    expect(editor).toHaveAttribute('readonly')

    await unmountComposerAndExpectPattern(editor, originalPattern)
    expect(screen.getByLabelText('Pattern title')).toHaveValue(originalTitle)
    expect(studio.savedChatStates.at(-1)?.messages).toEqual([])
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

    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const originalPattern = editor.value
    await sendPrompt('Start a beat')
    expect(await screen.findByText('REVISING…')).toBeVisible()
    expect(editor).toHaveValue(originalPattern)
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

  it('restores shared-pattern identity when a revision is cancelled', async () => {
    const metadata = deferred()
    studio.restoredPattern = {
      code: FIRST_PATTERN,
      customTitle: 'Shared original',
      sourcePrompt: 'Original prompt',
      shareId: 'shared-original',
    }
    studio.generations.push(SECOND_PATTERN)
    studio.metadataGates.push(metadata.promise)
    render(<PurpleStudio />)

    const editor = await screen.findByLabelText('Pattern code')
    await sendPrompt('Change the rhythm')
    await waitFor(() => expect(editor).toHaveValue(SECOND_PATTERN))
    await unmountComposerAndExpectPattern(editor, FIRST_PATTERN)

    const restored = studio.savedSessionPatterns.at(-1)
    expect(restored).toMatchObject({
      code: FIRST_PATTERN,
      customTitle: 'Shared original',
      sourcePrompt: 'Original prompt',
      shareId: 'shared-original',
    })
    metadata.resolve()
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

  it('does not append cancelled generated metadata after a hand edit', async () => {
    const { editor, metadata } = await startMetadataTailGeneration()

    await userEvent.clear(editor)
    await userEvent.type(editor, HAND_EDITED_PATTERN)
    await act(async () => metadata.resolve())

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clear session and start over' }))
        .toBeEnabled(),
    )
    expect(editor).toHaveValue(HAND_EDITED_PATTERN)
    expect(studio.savedChatStates.at(-1)?.messages).toEqual([
      { role: 'user', content: 'Start a beat' },
    ])
    expect(studio.savedSessionPatterns.at(-1)?.code).toBe(HAND_EDITED_PATTERN)
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
    expect(await screen.findByText('CHECKING…')).toBeVisible()
    expect(editor).toHaveValue(originalPattern)
    expect(editor).toHaveAttribute('readonly')

    await unmountComposerAndExpectPattern(editor, originalPattern)
    expect(studio.savedSessionPatterns.at(-1)?.code).toBe(originalPattern)
    validation.resolve()
  })

  it('does not publish a generated turn when validation rejects its pattern', async () => {
    studio.generations.push(FIRST_PATTERN)
    studio.validationResults.set(FIRST_PATTERN, [[{
      kind: 'evaluation',
      error: 'invalid generated pattern',
    }]])
    render(<PurpleStudio />)

    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const originalPattern = editor.value
    await sendPrompt('Start a beat')

    await screen.findByText(
      'Purple could not produce a playable pattern. Try describing the change another way.',
    )
    expect(editor).toHaveValue(originalPattern)
    expect(editor).not.toHaveAttribute('readonly')
    expect(studio.savedChatStates.at(-1)?.messages).toEqual([
      { role: 'user', content: 'Start a beat' },
    ])
    expect(studio.savedSessionPatterns.at(-1)?.code).toBe(originalPattern)
  })

  it('unlocks title editing only after generated metadata settles', async () => {
    const metadata = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.metadataGates.push(metadata.promise)
    render(<PurpleStudio />)

    await sendPrompt('Start a beat')
    const editor = await screen.findByLabelText('Pattern code')
    await waitFor(() => expect(editor).not.toHaveAttribute('readonly'))

    const title = screen.getByLabelText('Pattern title')
    expect(title).toBeDisabled()
    expect(screen.getByText('FINISHING…')).toBeVisible()
    metadata.resolve()

    await screen.findByRole('button', { name: 'Drift to dub' })
    expect(title).not.toBeDisabled()
    await userEvent.clear(title)
    await userEvent.type(title, 'My hand title')

    expect(title).toHaveValue('My hand title')
  })

  it('clears the session and brings it back through UNDO', async () => {
    await renderGeneratedPattern()
    expect(screen.getByRole('button', { name: 'Drift to dub' })).toBeVisible()

    await userEvent.click(
      screen.getByRole('button', { name: 'Clear session and start over' }),
    )
    await screen.findByText('What do you want to hear?')

    expect(screen.queryByText('Start a beat')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Drift to dub' })).toBeNull()
    expect(autoplayCheckbox()).toBeVisible()
    expect(studio.clearChatCalls).toBe(1)
    expect(screen.getByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN)

    const savesBeforeUndo = studio.saveChatCalls
    await userEvent.click(screen.getByRole('button', { name: 'UNDO' }))

    await screen.findByText('Start a beat')
    expect(screen.getByRole('button', { name: 'Drift to dub' })).toBeVisible()
    expect(screen.queryByText('What do you want to hear?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'UNDO' })).toBeNull()
    expect(studio.saveChatCalls).toBeGreaterThan(savesBeforeUndo)
  })

  it('keeps run controls off the progression copy line', async () => {
    await startModelPlannedRun()

    const action = screen.getByText(NEXT_ACTION)
    const controls = screen.getByRole('button', { name: 'STOP RUN' }).parentElement
    const row = action.closest('.progression-row')

    expect(controls).not.toBeNull()
    expect(row).not.toBeNull()
    expect(controls?.getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(action.getBoundingClientRect().top)
    expect(row?.scrollWidth).toBeLessThanOrEqual(row?.clientWidth ?? 0)

    await userEvent.click(screen.getByRole('button', { name: 'STOP RUN' }))
  })

  it('schedules a revision crossfade and lets the listener take it now', async () => {
    await startAndStageRevision()

    expect(studio.prepareValidationCalls).toBe(2)
    expect(studio.playCalls).toEqual([FIRST_PATTERN])
    expect(studio.validationCalls).toContain(FIRST_PATTERN)
    expect(studio.validationCalls).toContain(SECOND_PATTERN)
    expect(studio.validationCalls.filter((code) => code === SECOND_PATTERN)).toHaveLength(1)
    expect(studio.transitionCalls).toEqual([])
    const countdown = screen.getByText('XFADE IN 5s')
    expect(countdown).toBeVisible()
    expect(countdown.closest('[aria-live]:not([aria-live="off"])')).toBeNull()
    expect(screen.getByRole('group', { name: 'Crossfade duration' })).toBeVisible()
    expect(screen.getByRole('button', { name: '32 cycle crossfade' })).toBeVisible()
    expect(screen.getByRole('button', { name: '8 cycle crossfade' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', {
      name: 'Apply editor changes to playback (Ctrl+Enter)',
    })).toBeNull()
    const editor = screen.getByLabelText('Pattern code')
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        ctrlKey: true,
        key: 'Enter',
      }))
    })
    expect(studio.playCalls).toEqual([FIRST_PATTERN])

    await xfadeNow(SECOND_PATTERN)
    expect(studio.transitionCalls).toEqual([SECOND_PATTERN])
    expect(studio.transitionCycleCalls).toEqual([8])
  })

  it('starts only one crossfade when immediate actions overlap', async () => {
    const transition = deferredResult<TestPlaybackResult>()
    studio.transitionResults.push(transition.promise)
    await startAndStageRevision()

    const xfadeNow = screen.getByRole('button', { name: 'XFADE NOW' })
    act(() => {
      xfadeNow.click()
      xfadeNow.click()
    })

    expect(studio.transitionCalls).toEqual([SECOND_PATTERN])
    expect(screen.queryByLabelText('Generating')).toBeNull()
    await act(async () => transition.resolve({ ok: true }))
    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN))
  })

  it('crossfades a user-directed revision after five seconds', async () => {
    studio.generations.push(FIRST_PATTERN, SECOND_PATTERN)
    render(<PurpleStudio />)
    await sendPrompt('Start a beat')
    await playGeneratedPattern(FIRST_PATTERN)

    await sendPrompt('Make the hats faster')
    expect(await screen.findByText('XFADE IN 5s')).toBeVisible()

    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN), {
      timeout: 7_000,
    })
    expect(studio.transitionCalls).toEqual([SECOND_PATTERN])
    expect(studio.transitionCycleCalls).toEqual([8])
  })

  it('cancels a scheduled crossfade without discarding the revision', async () => {
    await startAndStageRevision()

    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }))

    expect(screen.queryByText(/XFADE IN/)).toBeNull()
    expect(screen.getByRole('button', { name: 'XFADE' })).toBeVisible()
    expect(screen.getByLabelText('Pattern code')).toHaveValue(SECOND_PATTERN)
    expect(studio.activeCode).toBe(FIRST_PATTERN)
    expect(studio.transitionCalls).toEqual([])
  })

  it('offers autoplay with bounded durations before any prompt', async () => {
    render(<PurpleStudio />)

    const duration = await screen.findByRole('combobox', {
      name: 'Run duration',
    }) as HTMLSelectElement
    expect(autoplayCheckbox()).not.toBeChecked()
    expect(duration.value).toBe(String(5 * 60 * 60_000))
    expect(getComputedStyle(duration).color)
      .toBe(getComputedStyle(document.documentElement).color)
    expect(Array.from(duration.options, ({ text }) => text)).toEqual([
      '30 MIN',
      '1 HR',
      '2 HR',
      '3 HR',
      '4 HR',
      '5 HR',
      '10 HR',
    ])

    await userEvent.selectOptions(duration, String(3 * 60 * 60_000))
    expect(duration.value).toBe(String(3 * 60 * 60_000))
    const armLabel = autoplayCheckbox().closest('label') as HTMLElement
    expect(duration.getBoundingClientRect().top)
      .toBeLessThan(armLabel.getBoundingClientRect().bottom)

    await armAutoplay()
    expect(studio.playCalls).toEqual([])
    expect(studio.streamMessages).toEqual([])
    expect(studio.progressionWaitCalls).toEqual([])
  })

  it('leaves the plan idle while autoplay stays unchecked', async () => {
    studio.generations.push(FIRST_PATTERN)
    render(<PurpleStudio />)

    await sendPrompt('Start a beat')
    await playGeneratedPattern(FIRST_PATTERN)

    expect(autoplayCheckbox()).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'STOP RUN' })).toBeNull()
    expect(studio.progressionWaitCalls).toEqual([])
    expect(studio.streamMessages).toHaveLength(1)
  })

  it('engages a run on a pattern the model never planned for', async () => {
    const musicalWake = deferred()
    studio.generations.push(SECOND_PATTERN)
    studio.progressionWaitGates.push(musicalWake.promise)
    render(<PurpleStudio />)
    await screen.findByLabelText('Describe the music')

    await armAutoplay()
    await userEvent.click(screen.getByRole('button', { name: /PLAY/ }))

    await waitFor(() => expect(studio.streamMessages).toHaveLength(1))
    const synthesizedRequest = studio.streamMessages[0] as Array<{
      role: string
      content: string
    }>
    expect(synthesizedRequest.at(-1)?.role).toBe('user')
    expect(synthesizedRequest.at(-1)?.content).toContain(CONTINUE_PATTERN_ACTION)
    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN))
    expect(studio.transitionCycleCalls).toEqual([16])
    await waitForProgressionWaits(1)

    await userEvent.click(screen.getByRole('button', { name: 'STOP RUN' }))
    expect(autoplayCheckbox()).not.toBeChecked()
  })

  it('runs the model-planned action after its musical wait and crossfades it', async () => {
    const musicalWake = await startModelPlannedRun()
    expect(studio.progressionWaitCalls).toEqual([PLANNED_CYCLES])
    expect(studio.streamMessages).toHaveLength(1)

    musicalWake.resolve()

    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN))
    expect(studio.transitionCalls).toEqual([SECOND_PATTERN])
    expect(studio.transitionCycleCalls).toEqual([16])
    expect(studio.streamMessages).toHaveLength(2)
    const automaticRequest = studio.streamMessages[1] as Array<{
      role: string
      content: string
    }>
    expect(automaticRequest.at(-1)).toMatchObject({
      role: 'user',
      content: NEXT_ACTION,
    })
  })

  it('steers one run turn and resumes from the returned progression', async () => {
    const firstWake = await startModelPlannedRun()
    const secondWake = deferred()
    studio.progressionWaitGates.push(secondWake.promise)
    const override = 'Keep the groove but dissolve the bells into dub echoes'

    await userEvent.type(screen.getByLabelText('Steer the next transition'), override)
    await userEvent.click(screen.getByRole('button', { name: 'STEER NEXT' }))

    expect(screen.getByText('YOUR NEXT')).toBeVisible()
    expect(screen.getByText(override)).toBeVisible()
    firstWake.resolve()

    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN))
    await waitForProgressionWaits(2)
    const automaticRequest = studio.streamMessages[1] as Array<{
      role: string
      content: string
    }>
    expect(automaticRequest.at(-1)).toMatchObject({
      role: 'user',
      content: override,
    })
    expect(screen.queryByText('YOUR NEXT')).toBeNull()
    expect(screen.getByText(NEXT_ACTION)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'STOP RUN' }))
  })

  it('restores the latest autoplay pattern when a later generation is stopped', async () => {
    const firstWake = await startModelPlannedRun()
    const secondWake = deferred()
    const metadata = deferred()
    studio.progressionWaitGates.push(secondWake.promise)

    firstWake.resolve()
    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN))
    await waitForProgressionWaits(2)

    studio.generations.push(FIXED_PATTERN)
    studio.metadataGates.push(metadata.promise)
    secondWake.resolve()
    await waitFor(() =>
      expect(screen.getByLabelText('Pattern code')).toHaveValue(FIXED_PATTERN),
    )

    await userEvent.click(screen.getByRole('button', { name: 'STOP RUN' }))
    await act(async () => metadata.resolve())

    await waitFor(() =>
      expect(screen.getByLabelText('Pattern code')).toHaveValue(SECOND_PATTERN),
    )
    expect(studio.activeCode).toBe(SECOND_PATTERN)
  })

  it('cancels autoplay generation when the main transport stops audio', async () => {
    const musicalWake = await startModelPlannedRun()
    const patternCompletion = deferred()
    studio.patternCompletionGates.push(patternCompletion.promise)

    musicalWake.resolve()
    await screen.findByText('GENERATING NEXT')
    await waitFor(() => expect(studio.streamMessages).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: '■ STOP' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN)
      expect(studio.activeCode).toBe('')
    })
    const cancelledChat = studio.savedChatStates.at(-1)?.messages
    expect(cancelledChat?.some(({ content }) => content.includes(NEXT_ACTION))).toBe(false)

    await act(async () => patternCompletion.resolve())
    expect(screen.getByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN)
    expect(studio.savedChatStates.at(-1)?.messages).toEqual(cancelledChat)
  })

  it('ignores validation failures from a stopped autoplay generation', async () => {
    const musicalWake = await startModelPlannedRun()
    const validation = deferred()
    studio.validationGates.push(validation.promise)
    studio.validationResults.set(SECOND_PATTERN, [[{
      kind: 'evaluation',
      error: 'cancelled validation detail',
    }]])

    musicalWake.resolve()
    await screen.findByText('CHECKING…')
    await userEvent.click(screen.getByRole('button', { name: 'STOP RUN' }))
    await act(async () => validation.resolve())

    await waitFor(() =>
      expect(screen.getByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN),
    )
    expect(document.body.textContent).not.toContain(
      'Purple could not produce a playable pattern',
    )
    expect(document.body.textContent).not.toContain('cancelled validation detail')
  })

  it('focuses the composer on the active run and shows its countdown', async () => {
    await startModelPlannedRun()

    expect(await screen.findByText('NEXT IN 1:01:52')).toBeVisible()
    const meterFill = () =>
      document.querySelector<HTMLElement>('.progression-meter-fill')
    expect(meterFill()?.style.width).toBe('0%')
    act(() => studio.reportProgressionWait?.(PLANNED_CYCLES / 4, 0.5))
    await waitFor(() => expect(meterFill()?.style.width).toBe('75%'))

    const action = screen.getByText(NEXT_ACTION)
    const actionStyle = getComputedStyle(action)
    expect(action).toBeVisible()
    expect(actionStyle.whiteSpace).toBe('normal')
    expect(action.getBoundingClientRect().height)
      .toBeGreaterThan(Number.parseFloat(actionStyle.lineHeight))

    const xfadeNow = screen.getByRole('button', { name: 'XFADE NOW' })
    const stopRun = screen.getByRole('button', { name: 'STOP RUN' })
    expect(xfadeNow).toBeVisible()
    expect(stopRun.getBoundingClientRect().left - xfadeNow.getBoundingClientRect().right)
      .toBeGreaterThanOrEqual(24)
    expect(screen.queryByText('EFFECT')).toBeNull()
    expect(screen.queryByText('NEXT')).toBeNull()
    expect(screen.queryByLabelText('Describe the music')).toBeNull()
    expect(screen.getByLabelText('Steer the next transition')).toBeVisible()

    await userEvent.click(stopRun)

    expect(autoplayCheckbox()).not.toBeChecked()
    expect(screen.getByText('EFFECT')).toBeVisible()
    expect(screen.getByText('NEXT')).toBeVisible()
    expect(screen.getByLabelText('Describe the music')).toBeVisible()
  })

  it('skips the musical wait and crossfades the planned revision now', async () => {
    await startModelPlannedRun()

    await xfadeNow(SECOND_PATTERN)
    expect(studio.transitionCalls).toEqual([SECOND_PATTERN])
    expect(studio.streamMessages).toHaveLength(2)
  })

  it('ends a run at its duration limit without stopping the current music', async () => {
    const musicalWake = deferred()
    studio.generations.push(FIRST_PATTERN)
    studio.progressionWaitGates.push(musicalWake.promise)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<PurpleStudio />)

    await sendPrompt('Start a beat')
    await armAutoplay()
    await playGeneratedPattern(FIRST_PATTERN)
    await waitForProgressionWaits(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 60_000)
    })

    expect(autoplayCheckbox()).not.toBeChecked()
    expect(screen.getByText('5 HR COMPLETE, AUTOPLAY OFF', { selector: 'strong' }))
      .toBeInTheDocument()
    expect(studio.activeCode).toBe(FIRST_PATTERN)
    expect(studio.stopCalls).toBe(0)
    expect(studio.streamMessages).toHaveLength(1)
  })

  it('cancels a musical wait before accepting a new direction', async () => {
    await startModelPlannedRun()

    await userEvent.click(screen.getByRole('button', { name: 'STOP RUN' }))
    await sendPrompt('Take it toward weightless ambient')

    await waitFor(() => expect(studio.streamMessages).toHaveLength(2))
    const manualRequest = studio.streamMessages[1] as Array<{
      role: string
      content: string
    }>
    expect(manualRequest.at(-1)).toMatchObject({
      role: 'user',
      content: 'Take it toward weightless ambient',
    })
    expect(studio.transitionCalls).toEqual([])
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

  it('commits a PLAY repair after streamed metadata settles', async () => {
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
    expect(screen.getByRole('button', { name: /PLAY/ })).toBeDisabled()

    metadata.resolve()
    await screen.findByRole('button', { name: 'Drift to dub' })
    await userEvent.click(screen.getByRole('button', { name: /PLAY/ }))
    await waitFor(() => expect(studio.activeCode).toBe(FIXED_PATTERN))
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
    expect(document.body.textContent).not.toContain(
      'Purple could not produce a playable pattern',
    )
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

    await userEvent.click(screen.getByRole('button', { name: 'XFADE NOW' }))

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

    await userEvent.click(screen.getByRole('button', { name: 'XFADE NOW' }))

    await screen.findByText(
      'The crossfade could not complete. Use PLAY to resume if playback stopped.',
    )
    expect(studio.repairMessages).toEqual([])
    expect(document.body.textContent).not.toContain('internal-transition-wrapper-detail')
    expect(screen.getByLabelText('Pattern code')).toHaveValue(SECOND_PATTERN)
    expect(screen.getByRole('button', { name: 'XFADE' })).toBeVisible()
  })

  it('does not restage a failed transition after a hand edit', async () => {
    const transition = deferredResult<TestPlaybackResult>()
    studio.transitionResults.push(transition.promise)
    await startAndStageRevision()

    await userEvent.click(screen.getByRole('button', { name: 'XFADE NOW' }))
    const editor = screen.getByLabelText('Pattern code')
    await userEvent.clear(editor)
    await userEvent.type(editor, HAND_EDITED_PATTERN)
    await act(async () => transition.resolve({
      ok: false,
      kind: 'evaluation',
      error: 'overtaken transition failure',
      source: 'candidate',
    }))

    await waitFor(() => expect(editor).toHaveValue(HAND_EDITED_PATTERN))
    expect(studio.repairMessages).toEqual([])
    expect(screen.queryByRole('button', { name: 'XFADE' })).toBeNull()
    expect(document.body.textContent).not.toContain(
      'Purple could not produce a playable pattern',
    )
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

  it('does not commit an older validation after identical code is adopted again', async () => {
    const validation = deferred()
    const onCodeChange = vi.fn()
    const hook = renderHook(() =>
      useGeneratedPattern({
        validatePattern: async () => {
          await validation.promise
          return []
        },
        requestFix: async () => null,
        onCodeChange,
        getStopToken: () => 0,
      }),
    )

    act(() => hook.result.current.adopt(FIRST_PATTERN, { commit: false }))
    const oldValidation = hook.result.current.validate(FIRST_PATTERN)
    act(() => {
      hook.result.current.invalidate()
      hook.result.current.adopt(FIRST_PATTERN, { commit: false })
    })
    await act(async () => validation.resolve())
    const outcome = await oldValidation

    expect(hook.result.current.isValidationCurrent(outcome)).toBe(false)
    expect(hook.result.current.commitCurrent(outcome)).toBe(false)
    expect(onCodeChange).not.toHaveBeenCalled()
  })

  it('does not publish an attempt from an older identical-code adoption', async () => {
    const operation = deferredResult<EvalResult>()
    const hook = renderHook(() =>
      useGeneratedPattern({
        validatePattern: async () => [],
        requestFix: async () => null,
        onCodeChange: vi.fn(),
        getStopToken: () => 0,
      }),
    )

    act(() => hook.result.current.adopt(FIRST_PATTERN, { commit: false }))
    const oldAttempt = hook.result.current.attempt(FIRST_PATTERN, () => operation.promise)
    act(() => {
      hook.result.current.invalidate()
      hook.result.current.adopt(FIRST_PATTERN, { commit: false })
    })
    await act(async () => operation.resolve({ ok: true }))
    const outcome = await oldAttempt

    expect(hook.result.current.isAttemptCurrent(outcome)).toBe(false)
  })

  it('does not publish an attempt after the listener stops', async () => {
    const operation = deferredResult<EvalResult>()
    let stopToken = 0
    const hook = renderHook(() =>
      useGeneratedPattern({
        validatePattern: async () => [],
        requestFix: async () => null,
        onCodeChange: vi.fn(),
        getStopToken: () => stopToken,
      }),
    )

    act(() => hook.result.current.adopt(FIRST_PATTERN, { commit: false }))
    const pendingAttempt = hook.result.current.attempt(
      FIRST_PATTERN,
      () => operation.promise,
    )
    stopToken++
    await act(async () => operation.resolve({ ok: true }))
    const outcome = await pendingAttempt

    expect(outcome.stopped).toBe(true)
    expect(hook.result.current.isAttemptCurrent(outcome)).toBe(false)
  })
})
