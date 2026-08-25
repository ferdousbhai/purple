/* oxlint-disable anti-slop/no-module-mocking -- The gallery browser flow keeps network, storage, and audio boundaries deterministic. */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Vitest's hoisted mutable fixtures need explicit result collection types. */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PatternsPage } from './patterns-page'

const gallery = vi.hoisted(() => ({
  playCalls: [] as string[],
  saved: [] as Array<{ id: string; shareId?: string }>,
  voteCalls: [] as Array<[string, number]>,
}))

vi.mock('#/lib/public-patterns', () => ({
  async fetchPatternPage() {
    return {
      patterns: [{
        id: 'Abc_123-xYz9',
        title: 'Acid rain',
        code: 's("bd*4")',
        createdAt: 1_700_000_000_000,
        likes: 2,
        dislikes: 1,
        score: 1,
        viewerVote: 0,
      }],
      nextCursor: null,
    }
  },
  async voteForPattern(id: string, value: number) {
    gallery.voteCalls.push([id, value])
    return { likes: 3, dislikes: 1, score: 2, viewerVote: value }
  },
}))

vi.mock('#/lib/patterns', () => ({
  removePattern: () => true,
  sharedLibraryId: (id: string) => `shared:${id}`,
  upsertPattern: (pattern: { id: string; shareId?: string }) => {
    gallery.saved.push(pattern)
    return true
  },
  usePatterns: () => [],
}))

vi.mock('#/lib/media-channel', () => ({ unlockMediaChannel: () => undefined }))
vi.mock('@purple/ui/use-playback', () => ({
  usePlayback: () => ({
    activeCode: '',
    error: null,
    playbackState: 'stopped',
    play: async (code: string) => {
      gallery.playCalls.push(code)
      return { ok: true as const }
    },
    stop: () => undefined,
  }),
}))

afterEach(() => {
  cleanup()
  gallery.playCalls.length = 0
  gallery.saved.length = 0
  gallery.voteCalls.length = 0
})

describe('public pattern gallery', () => {
  it('plays a card and makes Like update the library and public vote', async () => {
    const user = userEvent.setup()
    render(<PatternsPage />)

    expect(await screen.findByRole('heading', { name: 'Acid rain' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Acid rain/ })).toHaveAttribute(
      'href',
      '/?s=Abc_123-xYz9',
    )

    await user.click(screen.getByRole('button', { name: 'Play Acid rain' }))
    expect(gallery.playCalls).toEqual(['s("bd*4")'])

    await user.click(screen.getByRole('button', { name: 'Like Acid rain' }))
    await waitFor(() => expect(gallery.voteCalls).toEqual([['Abc_123-xYz9', 1]]))
    expect(gallery.saved).toEqual([
      expect.objectContaining({ id: 'shared:Abc_123-xYz9', shareId: 'Abc_123-xYz9' }),
    ])
  })
})
