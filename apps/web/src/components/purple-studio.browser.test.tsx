/* oxlint-disable anti-slop/no-module-mocking -- The browser flow keeps storage, editor, agent link, and audio boundaries deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted mutable fixtures need explicit collection and result types. */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '#/styles.css'
import { PurpleStudio as StudioPage, type PurpleStudioProps } from './purple-studio'
import { usePlayback } from '@purple/ui/use-playback'
import { WEB_AUDIO_OPTIONS } from '#/lib/playback'
import { SHOWCASE_PATTERNS } from '@purple/core/showcase-patterns'
import type { AgentLinkHandlers } from '@purple/ui/use-agent-link'
import type { EvalResult, PlaybackState } from '@purple/core/types'
import type { ValidationProblem } from '@purple/core/validation'

const FIRST_PATTERN = 's("bd sd")'
const SECOND_PATTERN = 's("hh*8")'

interface TestPlaybackSnapshot {
  playbackState: PlaybackState
  error: string | null
  activeCode: string
}

type TestPlaybackResult = EvalResult

const studio = vi.hoisted(() => ({
  agentHandlers: null as AgentLinkHandlers | null,
  agentUrl: '',
  setAgentLinked: null as ((linked: boolean) => void) | null,
  validationCalls: [] as string[],
  validationResults: new Map<string, ValidationProblem[]>(),
  playCalls: [] as string[],
  playResults: [] as unknown[],
  transitionCalls: [] as string[],
  transitionResults: [] as unknown[],
  stopCalls: 0,
  activeCode: '',
  savedPatterns: [] as Array<{
    id: string
    title: string
    code: string
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
    shareId?: string
  }>,
  restoredPattern: null as {
    code: string
    customTitle: string | null
    shareId?: string
  } | null,
}))

vi.mock('#/lib/patterns', () => ({
  loadSessionPattern: () => studio.restoredPattern,
  removePattern: () => true,
  saveSessionPattern: (pattern: {
    code: string
    customTitle: string | null
  }) => {
    studio.savedSessionPatterns.push(pattern)
  },
  sharedLibraryId: (id: string) => `shared:${id}`,
  uniquePatternTitle: (title: string) => title,
  upsertPattern: (pattern: {
    id: string
    title: string
    code: string
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

vi.mock('@purple/ui/use-agent-link', async () => {
  const React = await import('react')
  return {
    useAgentLink(options: { url: string; handlers: AgentLinkHandlers }) {
      const [linked, setLinked] = React.useState(false)
      studio.agentHandlers = options.handlers
      studio.agentUrl = options.url
      studio.setAgentLinked = setLinked
      return linked
    },
  }
})

vi.mock('@purple/ui/use-playback', async (importOriginal) => {
  const React = await import('react')
  // Only the hook is stubbed; the derived-state predicates beside it are pure.
  const actual = await importOriginal<typeof import('@purple/ui/use-playback')>()

  function settledSnapshot(
    result: TestPlaybackResult,
    code: string,
  ): TestPlaybackSnapshot | null {
    if (result.ok) {
      return { playbackState: 'playing', error: null, activeCode: code }
    }
    if (result.kind === 'cancelled') return null
    return { playbackState: 'error', error: result.error, activeCode: '' }
  }

  return {
    ...actual,
    usePlayback() {
      const [snapshot, setSnapshot] = React.useState<TestPlaybackSnapshot>({
        playbackState: 'stopped',
        error: null as string | null,
        activeCode: '',
      })
      const operationRef = React.useRef(0)
      studio.activeCode = snapshot.activeCode

      const attempt = React.useCallback(async (
        code: string,
        calls: string[],
        results: unknown[],
        pending: (current: TestPlaybackSnapshot) => TestPlaybackSnapshot,
      ) => {
        calls.push(code)
        const operation = ++operationRef.current
        setSnapshot(pending)
        const queued = results.shift()
        const result = await Promise.resolve(queued ?? { ok: true as const }) as TestPlaybackResult
        if (operation !== operationRef.current) {
          return { ok: false as const, kind: 'cancelled' as const }
        }
        const settled = settledSnapshot(result, code)
        if (settled !== null) setSnapshot(settled)
        return result
      }, [])

      const play = React.useCallback(
        (code: string) =>
          attempt(code, studio.playCalls, studio.playResults, () => ({
            playbackState: 'loading',
            error: null,
            activeCode: '',
          })),
        [attempt],
      )

      const transition = React.useCallback(
        (code: string) =>
          attempt(code, studio.transitionCalls, studio.transitionResults, (current) => ({
            ...current,
            playbackState: 'transitioning',
            error: null,
          })),
        [attempt],
      )

      const stop = React.useCallback(() => {
        studio.stopCalls++
        operationRef.current++
        setSnapshot({ playbackState: 'stopped', error: null, activeCode: '' })
      }, [])

      const validatePattern = React.useCallback(async (code: string) => {
        studio.validationCalls.push(code)
        return studio.validationResults.get(code) ?? []
      }, [])

      return {
        ...snapshot,
        play,
        transition,
        stop,
        validatePattern,
        getActiveSourceRanges: () => [],
        getOutputAnalyser: () => null,
      }
    },
  }
})

beforeEach(() => {
  studio.agentHandlers = null
  studio.agentUrl = ''
  studio.setAgentLinked = null
  studio.validationCalls.length = 0
  studio.validationResults.clear()
  studio.playCalls.length = 0
  studio.playResults.length = 0
  studio.transitionCalls.length = 0
  studio.transitionResults.length = 0
  studio.stopCalls = 0
  studio.activeCode = ''
  studio.savedPatterns.length = 0
  studio.upsertedPatterns.length = 0
  studio.savedSessionPatterns.length = 0
  studio.restoredPattern = null
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function agentHandlers(): AgentLinkHandlers {
  const handlers = studio.agentHandlers
  if (!handlers) throw new Error('The studio never opened an agent link.')
  return handlers
}

async function linkAgent() {
  const setLinked = studio.setAgentLinked
  if (!setLinked) throw new Error('The studio never opened an agent link.')
  await act(async () => setLinked(true))
}

async function renderPlayingStudio() {
  const rendered = render(<PurpleStudio />)
  await screen.findByLabelText('Pattern code')
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

/** The route owns playback in the app; here the mocked hook stands in. */
function PurpleStudio(props: Omit<PurpleStudioProps, 'playback'>) {
  return <StudioPage {...props} playback={usePlayback(WEB_AUDIO_OPTIONS)} />
}

describe('Purple studio browser flow', () => {
  it('opens a fresh session on a titled showcase without autoplaying it', async () => {
    render(<PurpleStudio />)

    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const showcase = SHOWCASE_PATTERNS.find(({ code }) => code === editor.value)
    if (!showcase) throw new Error('The editor did not receive a showcase pattern.')

    expect(screen.getByLabelText('Pattern title')).toHaveValue(showcase.title)
    expect(studio.playCalls).toEqual([])
  })

  it('restores an existing session instead of replacing it with a showcase', async () => {
    studio.restoredPattern = {
      code: FIRST_PATTERN,
      customTitle: 'Saved Session',
    }
    render(<PurpleStudio />)

    expect(await screen.findByLabelText('Pattern code')).toHaveValue(FIRST_PATTERN)
    expect(screen.getByLabelText('Pattern title')).toHaveValue('Saved Session')
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

  it('puts the equalizer first and keeps feedback beside library and the agent badge', async () => {
    const { container } = await renderPlayingStudio()

    const actions = container.querySelector('.topbar-actions')
    const feedback = screen.getByRole('button', { name: 'FEEDBACK' })
    const library = screen.getByRole('button', { name: 'LIBRARY' })
    const agent = screen.getByRole('button', { name: /AGENT/ })

    expect(actions?.firstElementChild).toHaveClass('eq-bars')
    expect(feedback.nextElementSibling).toBe(library)
    expect(library.nextElementSibling).toBe(agent)
  })

  it('applies an edit to live playback with Ctrl+Enter', async () => {
    await renderPlayingStudio()
    const editor = await screen.findByLabelText('Pattern code')

    await userEvent.clear(editor)
    await userEvent.type(editor, SECOND_PATTERN)
    expect(screen.getByRole('button', { name: /Apply editor changes/ })).toBeVisible()

    await userEvent.type(editor, '{Control>}{Enter}{/Control}')
    await waitFor(() => expect(studio.activeCode).toBe(SECOND_PATTERN))
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

  it('disables Save and Share when the editor has no pattern', async () => {
    render(<PurpleStudio />)
    const editor = await screen.findByLabelText('Pattern code')

    await userEvent.clear(editor)

    expect(screen.getByRole('button', { name: 'SAVE' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SHARE' })).toBeDisabled()
  })

  it('adds the public identity to a locally saved pattern after sharing', async () => {
    const saved = {
      id: 'local-pattern',
      title: 'Saved Pattern',
      code: FIRST_PATTERN,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_123,
    }
    studio.restoredPattern = {
      code: FIRST_PATTERN,
      customTitle: saved.title,
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
})

describe('agent pairing panel', () => {
  it('offers a registration command per client over one pairing endpoint', async () => {
    const { container } = render(<PurpleStudio />)

    expect(await screen.findByText('WAITING FOR YOUR AGENT')).toBeVisible()
    const pairingCode = studio.agentUrl.split('/link/')[1]
    const endpoint = `${window.location.origin}/mcp/${pairingCode}`
    const command = () => container.querySelector('.agent-command')?.textContent

    expect(command()).toBe(`claude mcp add --transport http purple ${endpoint}`)

    await userEvent.click(screen.getByRole('button', { name: 'CODEX' }))
    expect(command()).toBe(`codex mcp add purple --url ${endpoint}`)

    await userEvent.click(screen.getByRole('button', { name: 'OTHER' }))
    expect(command()).toBe(endpoint)
  })

  it('closes from inside the panel once the command is copied', async () => {
    const { container } = render(<PurpleStudio />)
    await screen.findByText('WAITING FOR YOUR AGENT')

    await userEvent.click(screen.getByRole('button', { name: 'CLOSE' }))

    expect(container.querySelector('.session-pane')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /AGENT/ }))
    expect(await screen.findByText('WAITING FOR YOUR AGENT')).toBeVisible()
  })

  it('hands the room back to the editor once an agent answers', async () => {
    const { container } = render(<PurpleStudio />)
    await screen.findByText('WAITING FOR YOUR AGENT')
    expect(container.querySelector('.session-pane')).not.toBeNull()

    await linkAgent()

    await waitFor(() => expect(container.querySelector('.session-pane')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: /AGENT/ }))
    expect(await screen.findByText('AGENT LINKED')).toBeVisible()
  })
})

describe('agent link handlers', () => {
  it('reports the editor session it would play', async () => {
    studio.restoredPattern = {
      code: FIRST_PATTERN,
      customTitle: 'Saved Session',
    }
    render(<PurpleStudio />)
    await screen.findByLabelText('Pattern code')

    expect(agentHandlers().getSession()).toEqual({
      code: FIRST_PATTERN,
      title: 'Saved Session',
      playbackState: 'stopped',
      playbackError: null,
    })
  })

  it('lands a validated pattern and its title in the editor', async () => {
    render(<PurpleStudio />)
    await screen.findByLabelText('Pattern code')

    await act(async () => {
      expect(await agentHandlers().setPattern(SECOND_PATTERN, 'Hat Study')).toEqual({
        committed: true,
      })
    })

    expect(screen.getByLabelText('Pattern code')).toHaveValue(SECOND_PATTERN)
    expect(screen.getByLabelText('Pattern title')).toHaveValue('Hat Study')
  })

  it('hands validation problems back instead of landing the pattern', async () => {
    studio.validationResults.set(SECOND_PATTERN, [
      { kind: 'unknown-sounds', sounds: [{ name: 'hhh', suggestions: ['hh'] }] },
    ])
    render(<PurpleStudio />)
    const editor = await screen.findByLabelText('Pattern code') as HTMLTextAreaElement
    const before = editor.value

    let outcome!: Awaited<ReturnType<AgentLinkHandlers['setPattern']>>
    await act(async () => {
      outcome = await agentHandlers().setPattern(SECOND_PATTERN, null)
    })

    expect(outcome).toMatchObject({ committed: false })
    if (outcome.committed) throw new Error('The studio committed an invalid pattern.')
    expect(outcome.problems.join(' ')).toContain('hhh')
    expect(editor).toHaveValue(before)
  })

  it('crossfades on play and clears the transport on stop', async () => {
    render(<PurpleStudio />)
    await screen.findByLabelText('Pattern code')

    await act(async () => {
      await agentHandlers().setPattern(FIRST_PATTERN, null)
    })
    await act(async () => {
      expect(await agentHandlers().play()).toEqual({ ok: true })
    })
    expect(studio.transitionCalls).toEqual([FIRST_PATTERN])
    await waitFor(() => expect(studio.activeCode).toBe(FIRST_PATTERN))

    await act(async () => agentHandlers().stop())
    expect(studio.stopCalls).toBe(1)
  })

  it('reports a failed play to the agent', async () => {
    studio.transitionResults.push({
      ok: false,
      kind: 'evaluation',
      error: 'hh is not defined',
      source: 'candidate',
    })
    render(<PurpleStudio />)
    await screen.findByLabelText('Pattern code')

    await act(async () => {
      expect(await agentHandlers().play()).toEqual({
        ok: false,
        error: 'hh is not defined',
      })
    })
  })
})
