/* oxlint-disable anti-slop/no-module-mocking -- The gallery browser flow keeps network, storage, and audio boundaries deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted mutable fixtures need explicit result collection types. */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PatternsPage } from './patterns-page'

const gallery = vi.hoisted(() => ({
  activeCode: '',
  navigateCalls: [] as string[],
  failSort: null as string | null,
  fetchCalls: [] as Array<[string, string | null]>,
  nextCursor: null as string | null,
  playCalls: [] as string[],
  playbackState: 'stopped',
  library: [] as Array<{
    id: string
    title: string
    code: string
    shareId?: string
    createdAt: number
    updatedAt: number
  }>,
  removed: [] as string[],
  saved: [] as Array<{ id: string; shareId?: string }>,
  stopCalls: 0,
  voteCalls: [] as Array<[string, number]>,
  voteFailures: 0,
  viewerVote: 0,
}))

vi.mock('#/lib/public-patterns', () => ({
  async fetchPatternPage(sort: string, cursor: string | null = null) {
    gallery.fetchCalls.push([sort, cursor])
    if (gallery.failSort === sort) throw new Error('Gallery unavailable')
    return {
      patterns: [{
        id: 'Abc_123-xYz9',
        title: 'Acid rain',
        code: 's("bd*4")',
        createdAt: 1_700_000_000_000,
        likes: 2,
        dislikes: 1,
        score: 1,
        viewerVote: gallery.viewerVote,
      }],
      nextCursor: gallery.nextCursor,
    }
  },
  async voteForPattern(id: string, value: number) {
    gallery.voteCalls.push([id, value])
    if (gallery.voteFailures > 0) {
      gallery.voteFailures--
      throw new Error('Vote unavailable')
    }
    return { likes: 3, dislikes: 1, score: 2, viewerVote: value }
  },
}))

vi.mock('#/lib/patterns', () => ({
  removePattern: (id: string) => {
    gallery.removed.push(id)
    gallery.library = gallery.library.filter((pattern) => pattern.id !== id)
    return true
  },
  sharedLibraryId: (id: string) => `shared:${id}`,
  upsertPattern: (pattern: {
    id: string
    title: string
    code: string
    shareId?: string
    createdAt: number
    updatedAt: number
  }) => {
    gallery.saved.push(pattern)
    gallery.library = [
      ...gallery.library.filter((saved) => saved.id !== pattern.id),
      pattern,
    ]
    return true
  },
  usePatterns: () => gallery.library,
}))

vi.mock('#/lib/media-channel', () => ({ unlockMediaChannel: () => undefined }))
vi.mock('@purple/ui/use-playback', () => ({
  usePlayback: () => ({
    activeCode: gallery.activeCode,
    error: null,
    playbackState: gallery.playbackState,
    play: async (code: string) => {
      gallery.playCalls.push(code)
      return { ok: true as const }
    },
    stop: () => {
      gallery.stopCalls++
    },
  }),
}))

afterEach(() => {
  cleanup()
  gallery.activeCode = ''
  gallery.navigateCalls.length = 0
  gallery.failSort = null
  gallery.fetchCalls.length = 0
  gallery.nextCursor = null
  gallery.playCalls.length = 0
  gallery.playbackState = 'stopped'
  gallery.library = []
  gallery.removed.length = 0
  gallery.saved.length = 0
  gallery.stopCalls = 0
  gallery.voteCalls.length = 0
  gallery.voteFailures = 0
  gallery.viewerVote = 0
})

function savedAcidPattern() {
  return {
    id: 'shared:Abc_123-xYz9',
    title: 'Acid rain',
    code: 's("bd*4")',
    shareId: 'Abc_123-xYz9',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }
}

describe('public pattern gallery', () => {
  it('plays a card and makes Like update the library and public vote', async () => {
    gallery.activeCode = 's("hh*4")'
    gallery.playbackState = 'playing'
    const user = userEvent.setup()
    render(<PatternsPage navigate={(href) => gallery.navigateCalls.push(href)} />)

    const heading = await screen.findByRole('heading', { name: 'Acid rain' })
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'PUBLIC PATTERNS',
    })).toBeVisible()
    expect(screen.getByText(
      'No key needed to listen. Vote for keepers, open any pattern in the studio.',
    )).toBeVisible()
    expect(screen.queryByRole('button', { name: 'STOP AUDIO' })).toBeNull()
    expect(screen.getByRole('link', { name: 'BACK TO STUDIO' })).toHaveClass(
      'primary',
      'patterns-studio-link',
    )
    expect(heading).toBeVisible()
    const open = screen.getByRole('link', { name: 'Open Acid rain in studio' })
    expect(open).toHaveAttribute(
      'href',
      '/?s=Abc_123-xYz9',
    )
    await user.click(heading)
    expect(gallery.navigateCalls).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Play Acid rain' }))
    expect(gallery.playCalls).toEqual(['s("bd*4")'])

    await user.click(open)
    expect(gallery.navigateCalls).toEqual(['/?s=Abc_123-xYz9'])
    expect(gallery.stopCalls).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Like Acid rain' }))
    await waitFor(() => expect(gallery.voteCalls).toEqual([['Abc_123-xYz9', 1]]))
    expect(gallery.saved).toEqual([
      expect.objectContaining({ id: 'shared:Abc_123-xYz9', shareId: 'Abc_123-xYz9' }),
    ])
  })

  it('rolls back a new library entry when Like fails', async () => {
    gallery.voteFailures = 1
    const user = userEvent.setup()
    render(<PatternsPage />)

    await user.click(await screen.findByRole('button', { name: 'Like Acid rain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Purple could not record that vote. Please try again.',
    )
    expect(gallery.library).toEqual([])
    expect(gallery.removed).toEqual(['shared:Abc_123-xYz9'])

    await user.click(screen.getByRole('button', { name: 'Like Acid rain' }))
    await waitFor(() => expect(gallery.voteCalls).toEqual([
      ['Abc_123-xYz9', 1],
      ['Abc_123-xYz9', 1],
    ]))
  })

  it('restores a saved pattern when Dislike fails', async () => {
    const saved = savedAcidPattern()
    gallery.library = [saved]
    gallery.voteFailures = 1
    const user = userEvent.setup()
    render(<PatternsPage />)

    await user.click(await screen.findByRole('button', { name: 'Dislike Acid rain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Purple could not record that vote. Please try again.',
    )
    expect(gallery.removed).toEqual([saved.id])
    expect(gallery.library).toEqual([saved])
  })

  it('keeps a saved disliked pattern distinct from its public vote', async () => {
    const saved = savedAcidPattern()
    gallery.library = [saved]
    gallery.viewerVote = -1
    const user = userEvent.setup()
    render(<PatternsPage />)

    const like = await screen.findByRole('button', { name: 'Like Acid rain' })
    expect(like).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', {
      name: 'Remove dislike from Acid rain',
    })).toHaveAttribute('aria-pressed', 'true')

    await user.click(like)
    await waitFor(() => expect(gallery.voteCalls).toEqual([['Abc_123-xYz9', 1]]))
    expect(gallery.removed).toEqual([])
    expect(gallery.library).toEqual([saved])
  })

  it('does not delete a later local Save when removing a Dislike', async () => {
    const saved = savedAcidPattern()
    gallery.library = [saved]
    gallery.viewerVote = -1
    const user = userEvent.setup()
    render(<PatternsPage />)

    await user.click(await screen.findByRole('button', {
      name: 'Remove dislike from Acid rain',
    }))
    await waitFor(() => expect(gallery.voteCalls).toEqual([['Abc_123-xYz9', 0]]))
    expect(gallery.removed).toEqual([])
    expect(gallery.library).toEqual([saved])
  })

  it('does not show stale Fresh results when loading Top fails', async () => {
    gallery.nextCursor = 'fresh-cursor'
    const user = userEvent.setup()
    render(<PatternsPage />)

    expect(await screen.findByRole('heading', { name: 'Acid rain' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'LOAD MORE' })).toBeVisible()
    gallery.failSort = 'top'
    await user.click(screen.getByRole('button', { name: 'TOP' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Purple could not load public patterns. Please try again.',
    )
    expect(screen.queryByRole('heading', { name: 'Acid rain' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'LOAD MORE' })).toBeNull()
    expect(screen.queryByText('No public patterns yet.')).toBeNull()
    expect(screen.queryByRole('link', { name: 'MAKE THE FIRST ONE' })).toBeNull()
    expect(screen.getByRole('button', { name: 'RETRY' })).toBeVisible()
  })

  it('retries a failed initial load and renders patterns on success', async () => {
    gallery.failSort = 'fresh'
    const user = userEvent.setup()
    render(<PatternsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Purple could not load public patterns. Please try again.',
    )
    expect(screen.queryByText('No public patterns yet.')).toBeNull()

    gallery.failSort = null
    await user.click(screen.getByRole('button', { name: 'RETRY' }))

    expect(await screen.findByRole('heading', { name: 'Acid rain' })).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(gallery.fetchCalls).toEqual([
      ['fresh', null],
      ['fresh', null],
    ])
  })

  it('does not append a duplicate card from a moved Top cursor', async () => {
    gallery.nextCursor = 'next-page'
    const user = userEvent.setup()
    render(<PatternsPage />)

    expect(await screen.findByRole('heading', { name: 'Acid rain' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'LOAD MORE' }))

    await waitFor(() => expect(gallery.fetchCalls).toEqual([
      ['fresh', null],
      ['fresh', 'next-page'],
    ]))
    expect(screen.getAllByRole('heading', { name: 'Acid rain' })).toHaveLength(1)
  })
})
