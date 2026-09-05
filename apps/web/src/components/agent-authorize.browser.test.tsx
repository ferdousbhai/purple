import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentAuthorize } from './agent-authorize'

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
    render(<AgentAuthorize search={SEARCH} leave={(url) => left.push(url)} />)

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

  it('shows the Worker\'s refusal instead of leaving', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Unknown client or redirect URI.' }, { status: 400 }),
    )
    const left: string[] = []
    render(<AgentAuthorize search={SEARCH} leave={(url) => left.push(url)} />)

    await userEvent.click(screen.getByRole('button', { name: 'DENY' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown client or redirect URI.')
    expect(left).toEqual([])
  })

  it('refuses an incomplete link', () => {
    render(<AgentAuthorize search="?state=only" />)
    expect(screen.getByRole('alert')).toHaveTextContent('incomplete')
  })
})
