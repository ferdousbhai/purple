import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSharedPattern, sharePublishError } from './public-patterns'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sharePublishError', () => {
  it('names rate limits, missing local workers, and Turnstile failures', () => {
    expect(sharePublishError(429, 'Too many requests.')).toBe(
      'Too many shares from this network. Wait a minute.',
    )
    expect(sharePublishError(404, null)).toBe(
      'Pattern service is not running in this dev server.',
    )
    expect(sharePublishError(405, 'Method not allowed.')).toBe(
      'Pattern service is not running in this dev server.',
    )
    expect(sharePublishError(403, 'Bot protection failed.')).toBe(
      'Bot protection expired or failed. Please retry.',
    )
    expect(sharePublishError(503, 'Pattern service is unavailable.')).toBe(
      'Pattern service is unavailable.',
    )
  })
})

describe('createSharedPattern', () => {
  const draft = { title: 'Acid rain', code: 's("bd*4")', handle: null }

  it('surfaces the publish error instead of a generic failure', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    await expect(createSharedPattern(draft, 'token'))
      .rejects.toThrow('Pattern service is not running in this dev server.')
  })

  it('does not claim the gallery is down when the network itself failed', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(createSharedPattern(draft, 'token'))
      .rejects.toThrow('Purple could not reach the public pattern service.')
  })
})
