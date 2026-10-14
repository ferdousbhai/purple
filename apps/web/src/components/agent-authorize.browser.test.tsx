import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentAuthorize } from './agent-authorize'
import { answerStudioPings } from '#/lib/studio-presence'

// A client id as the Worker mints it: base64url JSON, then a signature.
const CLIENT_ID = `${btoa(JSON.stringify({ kind: 'client', name: 'Claude Code' }))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}.sig`
const SEARCH =
  `?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent('http://localhost:5/cb')}` +
  '&state=s1&code_challenge=abc&code_challenge_method=S256'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AgentAuthorize', () => {
  it('names the client and sends Allow with this browser\'s pairing code', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)))
      return Response.json({ redirect: 'http://localhost:5/cb?code=x&state=s1' })
    })
    const left: string[] = []
    render(<AgentAuthorize search={SEARCH} leave={(url) => left.push(url)} openStudio={() => {}} />)

    expect(screen.getByText('Claude Code')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'ALLOW' }))

    await waitFor(() => expect(left).toEqual(['http://localhost:5/cb?code=x&state=s1']))
    expect(posted[0]).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: 'http://localhost:5/cb',
      state: 's1',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      decision: 'allow',
      pairing_code: expect.stringMatching(/^[0-9a-f]{20}$/),
    })
  })

  it.each([
    { studioOpen: false, opens: 1, title: 'opens the studio on Allow when no studio tab answers' },
    { studioOpen: true, opens: 0, title: 'leaves an open studio tab to do the pairing' },
  ])('$title', async ({ studioOpen, opens }) => {
    const stopAnswering = studioOpen ? answerStudioPings() : () => {}
    try {
      vi.stubGlobal('fetch', async () => Response.json({ redirect: 'http://localhost:5/cb?code=x' }))
      let opened = 0
      const left: string[] = []
      render(
        <AgentAuthorize search={SEARCH} leave={(url) => left.push(url)} openStudio={() => opened++} />,
      )
      // Give a studio's answer a moment to cross the channel.
      await new Promise((resolve) => setTimeout(resolve, 50))

      await userEvent.click(screen.getByRole('button', { name: 'ALLOW' }))

      await waitFor(() => expect(left).toEqual(['http://localhost:5/cb?code=x']))
      expect(opened).toBe(opens)
    } finally {
      stopAnswering()
    }
  })

  it('shows the Worker\'s refusal instead of leaving', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Unknown client or redirect URI.' }, { status: 400 }),
    )
    const left: string[] = []
    let opened = 0
    render(
      <AgentAuthorize search={SEARCH} leave={(url) => left.push(url)} openStudio={() => opened++} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'DENY' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown client or redirect URI.')
    expect(left).toEqual([])
    expect(opened).toBe(0)
  })

  it('refuses an incomplete link', () => {
    render(<AgentAuthorize search="?state=only" />)
    expect(screen.getByRole('alert')).toHaveTextContent('incomplete')
  })
})
