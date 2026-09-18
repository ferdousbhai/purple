import { useState, type FormEvent } from 'react'
import { DialogSubmitActions, ModalDialog } from './modal-dialog'
import { TurnstileFormEnd, useTurnstile } from './turnstile-widget'

const MAX_MESSAGE_LENGTH = 5_000

export function FeedbackDialog({
  onClose,
  playbackError,
}: {
  onClose: () => void
  playbackError: string | null
}) {
  const [category, setCategory] = useState('idea')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [includePlaybackError, setIncludePlaybackError] = useState(false)
  const turnstile = useTurnstile()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const hasNote = Boolean(message.trim())

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!turnstile.token || !hasNote || submitting) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const body = new URLSearchParams({
        category,
        email: email.trim(),
        message: composeFeedbackMessage(
          message.trim(),
          playbackError,
          includePlaybackError,
        ),
        website,
        turnstileToken: turnstile.token,
      })
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body,
      })

      if (!response.ok) {
        setSubmitError(feedbackError(response.status))
        turnstile.reset()
        return
      }

      setSubmitted(true)
    } catch {
      setSubmitError(
        'Purple could not reach the feedback service. Please try again.',
      )
      turnstile.reset()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalDialog
      className="feedback-dialog"
      dismissible={!submitting}
      titleId="feedback-title"
      descriptionId="feedback-privacy"
      title="Send feedback"
      closeLabel="Close feedback"
      onClose={onClose}
    >
      {(close) => submitted ? (
        <section className="feedback-success" role="status">
          <p id="feedback-privacy">Thanks for your feedback.</p>
          <button type="button" className="primary" onClick={close}>DONE</button>
        </section>
      ) : (
        <form className="feedback-form" onSubmit={submit}>
          <p id="feedback-privacy" className="feedback-privacy">
            Your feedback goes to Ferdous, the creator of Purple.
            Only this form is sent to Purple. Do not include your pairing link,
            pattern code, or other private information.
          </p>

          <label>
            <span>ABOUT</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="idea">Idea or request</option>
              <option value="bug">Something is broken</option>
              <option value="music">Music quality</option>
              <option value="other">Something else</option>
            </select>
          </label>

          <label>
            <span>EMAIL FOR A REPLY <small>OPTIONAL</small></span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label>
            <span>YOUR NOTE</span>
            <textarea
              autoFocus
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              minLength={3}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={7}
              placeholder="What should Purple do better?"
            />
          </label>

          {playbackError ? (
            <label className="feedback-include">
              <input
                type="checkbox"
                checked={includePlaybackError}
                onChange={(event) => setIncludePlaybackError(event.target.checked)}
              />
              <span>
                INCLUDE THE CURRENT PLAYBACK ERROR
                <small>{playbackError}</small>
              </span>
            </label>
          ) : null}

          <label className="feedback-honeypot" aria-hidden="true">
            Website
            <input
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </label>

          {submitError ? <p className="error" role="alert">{submitError}</p> : null}

          <TurnstileFormEnd action="purple_feedback" turnstile={turnstile}>
            <DialogSubmitActions
              checking={hasNote && turnstile.waiting}
              disabled={!hasNote || !turnstile.token || submitting}
              idleLabel="SEND FEEDBACK"
              onCancel={close}
              pending={submitting}
              pendingLabel="SENDING…"
            />
          </TurnstileFormEnd>
        </form>
      )}
    </ModalDialog>
  )
}

function composeFeedbackMessage(
  note: string,
  playbackError: string | null,
  includePlaybackError: boolean,
): string {
  if (!includePlaybackError || !playbackError) return note
  const combined = `${note}\n\nPlayback error:\n${playbackError}`
  return combined.length <= MAX_MESSAGE_LENGTH
    ? combined
    : combined.slice(0, MAX_MESSAGE_LENGTH)
}

function feedbackError(status: number): string {
  if (status === 400 || status === 413) {
    return 'Check the form fields and keep the note under 5,000 characters.'
  }
  if (status === 403) return 'Bot protection expired or failed. Please retry.'
  if (status === 404 || status === 405) {
    return 'Feedback service is not running in this dev server.'
  }
  return 'Purple could not deliver the note. Please try again in a moment.'
}
