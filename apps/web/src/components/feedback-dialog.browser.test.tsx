import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackDialog } from './feedback-dialog'

interface SubmissionCapture {
  body: URLSearchParams | null
}

afterEach(() => {
  cleanup()
  delete window.turnstile
  vi.unstubAllGlobals()
})

describe('feedback dialog', () => {
  it('submits only the explicit form fields after Turnstile succeeds', async () => {
    const submission: SubmissionCapture = { body: null }
    let renderedSiteKey = ''
    window.turnstile = {
      render(_container, options) {
        renderedSiteKey = options.sitekey
        options.callback('test-turnstile-token')
        return 'feedback-widget'
      },
      remove() {},
      reset() {},
    }
    const submitFeedback: typeof fetch = async (_input, init) => {
      submission.body = new URLSearchParams(String(init?.body ?? ''))
      return Response.json({ ok: true })
    }
    vi.stubGlobal('fetch', submitFeedback)

    const user = userEvent.setup()
    render(<FeedbackDialog onClose={() => undefined} playbackError={null} />)

    expect(await screen.findByRole('dialog', { name: 'Send a note to Ferdous' })).toBeVisible()
    expect(screen.getByText(/Only this form is sent to Purple/)).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox'), 'bug')
    await user.type(screen.getByPlaceholderText('you@example.com'), 'listener@example.com')
    await user.type(screen.getByPlaceholderText('What should Purple do better?'), 'Playback stopped twice.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND FEEDBACK' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'SEND FEEDBACK' }))

    expect(await screen.findByText('Your note reached Ferdous.')).toBeVisible()
    expect(renderedSiteKey).toBe('1x00000000000000000000AA')
    expect(submission.body?.get('category')).toBe('bug')
    expect(submission.body?.get('email')).toBe('listener@example.com')
    expect(submission.body?.get('message')).toBe('Playback stopped twice.')
    expect(submission.body?.get('turnstileToken')).toBe('test-turnstile-token')
    expect([...(submission.body?.keys() ?? [])]).toEqual([
      'category',
      'email',
      'message',
      'website',
      'turnstileToken',
    ])
  })

  it('appends the current playback error only when asked', async () => {
    const submission: SubmissionCapture = { body: null }
    window.turnstile = {
      render(_container, options) {
        options.callback('test-turnstile-token')
        return 'feedback-widget'
      },
      remove() {},
      reset() {},
    }
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      submission.body = new URLSearchParams(String(init?.body ?? ''))
      return Response.json({ ok: true })
    })

    const user = userEvent.setup()
    render(
      <FeedbackDialog
        onClose={() => undefined}
        playbackError="Pattern used an unknown sound: xyz"
      />,
    )

    expect(await screen.findByText('Pattern used an unknown sound: xyz')).toBeVisible()
    await user.type(
      screen.getByPlaceholderText('What should Purple do better?'),
      'It died on play.',
    )
    await user.click(screen.getByRole('checkbox', {
      name: /INCLUDE THE CURRENT PLAYBACK ERROR/,
    }))
    await user.click(await screen.findByRole('button', { name: 'SEND FEEDBACK' }))

    expect(await screen.findByText('Your note reached Ferdous.')).toBeVisible()
    expect(submission.body?.get('message')).toBe(
      'It died on play.\n\nPlayback error:\nPattern used an unknown sound: xyz',
    )
  })
})
