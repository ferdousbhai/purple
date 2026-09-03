import { describe, expect, it } from 'vitest'
import {
  handleAssetRequest,
  handleFeedbackRequest,
  redirectToCanonicalOrigin,
  routeMetadata,
} from './index'

interface EmailHarness {
  env: Pick<Env, 'FEEDBACK_EMAIL' | 'TURNSTILE_SECRET'>
  sent: EmailMessageBuilder[]
}

describe('canonical origin redirect', () => {
  it('redirects HTTP and www requests to the HTTPS apex with path and query intact', () => {
    const response = redirectToCanonicalOrigin(
      new Request('http://www.soundspurple.com/patterns?sort=hot'),
    )

    expect(response?.status).toBe(308)
    expect(response?.headers.get('Location')).toBe(
      'https://soundspurple.com/patterns?sort=hot',
    )
  })

  it('leaves the canonical origin and local development hosts unchanged', () => {
    expect(
      redirectToCanonicalOrigin(new Request('https://soundspurple.com/patterns')),
    ).toBeNull()
    expect(
      redirectToCanonicalOrigin(new Request('http://localhost:8787/patterns')),
    ).toBeNull()
  })
})

describe('route shell delivery', () => {
  it('defines distinct canonical metadata for the public gallery', () => {
    expect(routeMetadata('/patterns')).toEqual({
      title: 'Public Strudel Patterns | Purple',
      heading: 'Public Strudel patterns to play, save, and remix',
      description:
        'Browse, play, save, and remix public Strudel patterns made with Purple. Listening needs nothing but a browser.',
      url: 'https://soundspurple.com/patterns',
    })
    expect(routeMetadata('/')).toBeNull()
  })

  it('preserves the HTML fallback for client-side routes', async () => {
    let removedStudioPreload = false
    const response = await handleAssetRequest(
      documentRequest('https://soundspurple.com/patterns'),
      spaAssets(),
      (html, pathname) => {
        removedStudioPreload = true
        expect(pathname).toBe('/patterns')
        return html
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html')
    expect(removedStudioPreload).toBe(true)
  })

  it('serves the known patterns route without requiring an HTML Accept header', async () => {
    const response = await handleAssetRequest(
      new Request('https://soundspurple.com/patterns'),
      spaAssets(),
      (html) => html,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves an uncached HEAD response for the known patterns route', async () => {
    let rewrites = 0
    const response = await handleAssetRequest(
      new Request('https://soundspurple.com/patterns', { method: 'HEAD' }),
      spaAssets(),
      (html) => {
        rewrites++
        return html
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Length')).toBeNull()
    expect(rewrites).toBe(0)
  })

  it('keeps the editor preload on the studio route', async () => {
    let removedStudioPreload = false
    const response = await handleAssetRequest(
      new Request('https://soundspurple.com/'),
      spaAssets(),
      (html) => {
        removedStudioPreload = true
        return html
      },
    )

    expect(response.status).toBe(200)
    expect(removedStudioPreload).toBe(false)
  })

  it('does not reuse root validators or ranges for transformed route HTML', async () => {
    const fetched: Request[] = []
    const assets: Pick<Fetcher, 'fetch'> = {
      fetch: async (input) => {
        const request = new Request(input)
        fetched.push(request)
        if (new URL(request.url).pathname !== '/') {
          return new Response('Not found.', { status: 404 })
        }
        return new Response('<!doctype html><title>Purple</title>', {
          headers: {
            'Content-Type': 'text/html',
            ETag: '"root-build"',
            'Last-Modified': 'Tue, 25 Aug 2026 12:00:00 GMT',
          },
        })
      },
    }
    const request = new Request('https://soundspurple.com/patterns', {
      headers: {
        Accept: 'text/html',
        'If-None-Match': '"root-build"',
        'If-Modified-Since': 'Tue, 25 Aug 2026 12:00:00 GMT',
        'If-Range': '"root-build"',
        Range: 'bytes=0-99',
      },
    })

    const response = await handleAssetRequest(request, assets, (html) => html)

    expect(fetched).toHaveLength(1)
    for (const name of [
      'If-None-Match',
      'If-Modified-Since',
      'If-Range',
      'Range',
    ]) {
      expect(fetched[0]?.headers.get(name)).toBeNull()
    }
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('ETag')).toBeNull()
    expect(response.headers.get('Last-Modified')).toBeNull()
  })
})

describe('feedback Worker', () => {
  it('verifies Turnstile and sends the submitted fields as plain text', async () => {
    const harness = createEmailHarness()
    const response = await handleFeedbackRequest(
      feedbackRequest({
        category: 'music',
        email: 'listener@example.com',
        message: 'The bass suggestions could use more movement.',
        turnstileToken: 'verified-token',
      }),
      harness.env,
      validSiteverify(),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(harness.sent).toHaveLength(1)
    expect(harness.sent[0]).toMatchObject({
      to: 'ferdous@hey.com',
      from: { email: 'feedback@soundspurple.com', name: 'Purple Feedback' },
      replyTo: 'listener@example.com',
      subject: '[Purple feedback] Music quality',
    })
    expect(harness.sent[0]?.text).toContain('The bass suggestions could use more movement.')
  })

  it('rejects a valid token issued for the wrong action or hostname', async () => {
    const harness = createEmailHarness()
    const response = await handleFeedbackRequest(
      feedbackRequest(),
      harness.env,
      async () => Response.json({
        success: true,
        action: 'login',
        hostname: 'attacker.example',
      }),
    )

    expect(response.status).toBe(403)
    expect(harness.sent).toHaveLength(0)
  })

  it('silently discards submissions that fill the honeypot', async () => {
    const harness = createEmailHarness()
    let verificationCalls = 0
    const response = await handleFeedbackRequest(
      feedbackRequest({ website: 'https://spam.example' }),
      harness.env,
      async () => {
        verificationCalls++
        return Response.json({ success: false })
      },
    )

    expect(response.status).toBe(200)
    expect(verificationCalls).toBe(0)
    expect(harness.sent).toHaveLength(0)
  })

  it('rejects cross-origin, malformed, and oversized feedback', async () => {
    const harness = createEmailHarness()
    const crossOrigin = feedbackRequest({}, 'https://attacker.example')
    const malformed = feedbackRequest({ email: 'not-an-email' })
    const oversized = feedbackRequest({ message: 'x'.repeat(12_001) })

    expect((await handleFeedbackRequest(crossOrigin, harness.env, validSiteverify())).status).toBe(403)
    expect((await handleFeedbackRequest(malformed, harness.env, validSiteverify())).status).toBe(400)
    expect((await handleFeedbackRequest(oversized, harness.env, validSiteverify())).status).toBe(413)
    expect(harness.sent).toHaveLength(0)
  })

  it('does not claim success when the email binding fails', async () => {
    const harness = createEmailHarness(true)
    const response = await handleFeedbackRequest(
      feedbackRequest(),
      harness.env,
      validSiteverify(),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Feedback could not be delivered.' })
  })
})

function feedbackRequest(
  overrides: Record<string, string> = {},
  origin = 'https://soundspurple.com',
): Request {
  const body = new URLSearchParams({
    category: 'idea',
    email: '',
    message: 'Please add a way to pin a transition.',
    website: '',
    turnstileToken: 'verified-token',
    ...overrides,
  })
  return new Request('https://soundspurple.com/api/feedback', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
  })
}

function createEmailHarness(fail = false): EmailHarness {
  const sent: EmailMessageBuilder[] = []
  const email: SendEmail = {
    async send(message: EmailMessage | EmailMessageBuilder) {
      if (!('subject' in message)) throw new Error('Expected a structured email builder.')
      sent.push(message)
      if (fail) throw new Error('Test delivery failure.')
      return { messageId: 'test-message' }
    },
  }
  return {
    env: { FEEDBACK_EMAIL: email, TURNSTILE_SECRET: 'test-secret' },
    sent,
  }
}

function validSiteverify(): typeof fetch {
  return async () => Response.json({
    success: true,
    action: 'purple_feedback',
    hostname: 'soundspurple.com',
  })
}

function documentRequest(url: string): Request {
  return new Request(url, { headers: { Accept: 'text/html' } })
}

function spaAssets(): Pick<Fetcher, 'fetch'> {
  return {
    fetch: async (input) => {
      const request = new Request(input)
      if (new URL(request.url).pathname !== '/') {
        return new Response('Not found.', { status: 404 })
      }
      return new Response('<!doctype html><title>Purple</title>', {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Type': 'text/html',
        },
      })
    },
  }
}
