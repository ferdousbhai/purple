import { describe, expect, it } from 'vitest'
import { handleFeedbackRequest } from './index'

interface EmailHarness {
  env: Pick<Env, 'FEEDBACK_EMAIL' | 'TURNSTILE_SECRET'>
  sent: EmailMessageBuilder[]
}

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
