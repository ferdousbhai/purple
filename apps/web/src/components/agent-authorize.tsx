/**
 * The /authorize page: an MCP client sent the person's browser here. This
 * browser already holds the pairing code, so one click pairs the client
 * with it. The Worker verifies the client and mints the code; the page
 * only shows who is asking and carries the decision.
 */
import { jsonText, parseJsonMembers } from '@purple/core/json'
import { useState } from 'react'
import { loadAgentLinkSettings } from '#/lib/agent-link-storage'

const DEFAULT_CLIENT_NAME = 'An MCP client'

export function AgentAuthorize(props: {
  search: string
  /** Where the browser goes after the decision; the client's own callback. */
  leave?: (url: string) => void
}) {
  const params = new URLSearchParams(props.search)
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const leave = props.leave ?? ((url: string) => window.location.assign(url))

  if (!clientId || !redirectUri) {
    return (
      <main autoFocus className="route-message" tabIndex={-1}>
        <h1>PURPLE</h1>
        <p role="alert">This authorization link is incomplete. Start again from your agent.</p>
      </main>
    )
  }

  const decide = async (decision: 'allow' | 'deny') => {
    setPending(decision)
    setError(null)
    try {
      const response = await fetch('/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          state: params.get('state'),
          code_challenge: params.get('code_challenge'),
          code_challenge_method: params.get('code_challenge_method'),
          pairing_code: loadAgentLinkSettings().code,
          decision,
        }),
      })
      const body = parseJsonMembers(await response.text())
      const redirect = jsonText(body?.get('redirect'))
      if (!response.ok || redirect === null) {
        throw new Error(
          jsonText(body?.get('error')) ?? 'Purple could not record the decision.',
        )
      }
      leave(redirect)
    } catch (cause) {
      setPending(null)
      setError(cause instanceof Error ? cause.message : 'Purple could not record the decision.')
    }
  }

  return (
    <main autoFocus className="route-message authorize" tabIndex={-1}>
      <h1>PURPLE</h1>
      <p>
        <strong>{clientDisplayName(clientId)}</strong> wants to play Purple in
        this browser.
      </p>
      <p className="muted">
        Allow pairs it with this browser&rsquo;s studio tab. It can write and
        play patterns here until you remove it from your agent.
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="authorize-actions">
        <button
          type="button"
          className="chrome"
          disabled={pending !== null}
          onClick={() => void decide('deny')}
        >
          DENY
        </button>
        <button
          type="button"
          className="primary"
          disabled={pending !== null}
          onClick={() => void decide('allow')}
        >
          {pending === 'allow' ? 'PAIRING…' : 'ALLOW'}
        </button>
      </div>
    </main>
  )
}

/** The client's registered name, read from its id without verifying it: the
 * Worker verifies before anything is issued, and a forged name only mislabels
 * a page whose Allow button then fails. */
function clientDisplayName(clientId: string): string {
  try {
    const body = clientId.split('.', 1)[0] ?? ''
    const fields = parseJsonMembers(atob(body.replaceAll('-', '+').replaceAll('_', '/')))
    const name = jsonText(fields?.get('name'))?.trim()
    if (name) return name
  } catch {
    // Not one of ours; the Worker will say so.
  }
  return DEFAULT_CLIENT_NAME
}
