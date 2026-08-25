import { jsonResponse } from './http'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type SiteverifyFetch = typeof fetch
type TurnstileResult = 'invalid' | 'unavailable' | 'valid'

export function turnstileFailureResponse(result: TurnstileResult): Response | null {
  if (result === 'invalid') {
    return jsonResponse({ error: 'Bot protection failed.' }, 403)
  }
  if (result === 'unavailable') {
    return jsonResponse({ error: 'Bot protection is unavailable.' }, 503)
  }
  return null
}

interface TurnstileVerification {
  success?: boolean
  hostname?: string
  action?: string
}

export async function verifyTurnstile(
  token: string,
  expectedAction: string,
  expectedHostname: string,
  remoteIp: string | null,
  secret: string,
  siteverifyFetch: SiteverifyFetch,
  requestId: string,
): Promise<TurnstileResult> {
  try {
    const body = new FormData()
    body.set('secret', secret)
    body.set('response', token)
    body.set('idempotency_key', crypto.randomUUID())
    if (remoteIp) body.set('remoteip', remoteIp)

    const response = await siteverifyFetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      console.error(JSON.stringify({
        event: 'turnstile_unavailable',
        requestId,
        action: expectedAction,
        status: response.status,
      }))
      return 'unavailable'
    }

    const verification: TurnstileVerification | null = await response.json()
    if (
      verification?.success !== true ||
      verification.action !== expectedAction ||
      verification.hostname !== expectedHostname
    ) return 'invalid'

    return 'valid'
  } catch (error) {
    console.error(JSON.stringify({
      event: 'turnstile_unavailable',
      requestId,
      action: expectedAction,
      errorName: error instanceof Error ? error.name : 'NonError',
    }))
    return 'unavailable'
  }
}
