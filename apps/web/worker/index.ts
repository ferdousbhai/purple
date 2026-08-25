import { hasContentType, jsonResponse, readBoundedBody } from './http'
import { handlePatternRequest } from './patterns'
import {
  type SiteverifyFetch,
  turnstileFailureResponse,
  verifyTurnstile,
} from './turnstile'

const FEEDBACK_PATH = '/api/feedback'
const FEEDBACK_SENDER = 'feedback@soundspurple.com'
const FEEDBACK_RECIPIENT = 'ferdous@hey.com'
const TURNSTILE_ACTION = 'purple_feedback'
const MAX_REQUEST_BYTES = 12_000
const MAX_MESSAGE_LENGTH = 5_000
const MAX_EMAIL_LENGTH = 254
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048

const CATEGORY_LABELS = {
  bug: 'Something is broken',
  idea: 'Idea or request',
  music: 'Music quality',
  other: 'Something else',
} as const

type FeedbackCategory = keyof typeof CATEGORY_LABELS
type FeedbackEnv = Pick<Env, 'FEEDBACK_EMAIL' | 'TURNSTILE_SECRET'>
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === FEEDBACK_PATH) {
      return handleFeedbackRequest(request, env)
    }
    if (url.pathname.startsWith('/api/')) {
      return handlePatternRequest(request, env)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

export async function handleFeedbackRequest(
  request: Request,
  env: FeedbackEnv,
  siteverifyFetch: SiteverifyFetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, { Allow: 'POST' })
  }

  const url = new URL(request.url)
  if (request.headers.get('Origin') !== url.origin) {
    return jsonResponse({ error: 'Cross-origin submissions are not allowed.' }, 403)
  }

  if (!hasContentType(request, 'application/x-www-form-urlencoded')) {
    return jsonResponse({ error: 'Unsupported request format.' }, 415)
  }

  const bodyResult = await readBoundedBody(request, MAX_REQUEST_BYTES)
  if (!bodyResult.ok) {
    return jsonResponse({ error: 'Feedback is too large.' }, 413)
  }

  const form = new URLSearchParams(bodyResult.body)
  if (form.get('website')) {
    // A hidden-field hit is acknowledged without revealing that it was discarded.
    return jsonResponse({ ok: true }, 200)
  }

  const category = form.get('category') ?? ''
  const email = (form.get('email') ?? '').trim()
  const message = (form.get('message') ?? '').trim()
  const turnstileToken = form.get('turnstileToken') ?? ''

  if (
    !isFeedbackCategory(category) ||
    message.length < 3 ||
    message.length > MAX_MESSAGE_LENGTH ||
    email.length > MAX_EMAIL_LENGTH ||
    (email.length > 0 && !isEmailAddress(email)) ||
    turnstileToken.length < 1 ||
    turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH
  ) {
    return jsonResponse({ error: 'Invalid feedback fields.' }, 400)
  }

  const requestId = crypto.randomUUID()
  const turnstile = await verifyTurnstile(
    turnstileToken,
    TURNSTILE_ACTION,
    url.hostname,
    request.headers.get('CF-Connecting-IP'),
    env.TURNSTILE_SECRET,
    siteverifyFetch,
    requestId,
  )
  const verificationFailure = turnstileFailureResponse(turnstile)
  if (verificationFailure) return verificationFailure

  const emailMessage: EmailMessageBuilder = {
    to: FEEDBACK_RECIPIENT,
    from: { email: FEEDBACK_SENDER, name: 'Purple Feedback' },
    subject: `[Purple feedback] ${CATEGORY_LABELS[category]}`,
    text: formatEmail(category, email, message, requestId),
  }
  if (email) emailMessage.replyTo = email

  try {
    await env.FEEDBACK_EMAIL.send(emailMessage)
  } catch (error) {
    console.error(JSON.stringify({
      event: 'feedback_email_failed',
      requestId,
      errorName: error instanceof Error ? error.name : 'NonError',
    }))
    return jsonResponse({ error: 'Feedback could not be delivered.' }, 503)
  }

  console.log(JSON.stringify({ event: 'feedback_email_sent', requestId, category }))
  return jsonResponse({ ok: true, requestId }, 200)
}

function isFeedbackCategory(value: string): value is FeedbackCategory {
  return Object.hasOwn(CATEGORY_LABELS, value)
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function formatEmail(
  category: FeedbackCategory,
  email: string,
  message: string,
  requestId: string,
): string {
  return [
    'New feedback from soundspurple.com',
    '',
    `Category: ${CATEGORY_LABELS[category]}`,
    `Reply email: ${email || 'Not provided'}`,
    `Received: ${new Date().toISOString()}`,
    `Reference: ${requestId}`,
    '',
    message,
  ].join('\n')
}
