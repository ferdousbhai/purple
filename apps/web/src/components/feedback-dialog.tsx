import {
  useCallback,
  useState,
  type FormEvent,
} from 'react'
import { DialogSubmitActions, ModalDialog } from './modal-dialog'
import { TurnstileFormEnd } from './turnstile-widget'

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState('idea')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileError, setTurnstileError] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const acceptTurnstileToken = useCallback((token: string) => {
    setTurnstileError(null)
    setTurnstileToken(token)
  }, [])
  const rejectTurnstileToken = useCallback(() => {
    setTurnstileToken('')
    setTurnstileError('Bot protection could not verify this browser. Please retry.')
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!turnstileToken || !message.trim() || submitting) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const body = new URLSearchParams({
        category,
        email: email.trim(),
        message: message.trim(),
        website,
        turnstileToken,
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
        setTurnstileToken('')
        setResetKey((key) => key + 1)
        return
      }

      setSubmitted(true)
    } catch {
      setSubmitError('Purple could not reach the feedback service. Please try again.')
      setTurnstileToken('')
      setResetKey((key) => key + 1)
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
      title="Send a note to Ferdous"
      closeLabel="Close feedback"
      onClose={onClose}
    >
      {(close) => submitted ? (
        <section className="feedback-success" role="status">
          <p id="feedback-privacy">Your note reached Ferdous.</p>
          <button type="button" className="primary" onClick={close}>DONE</button>
        </section>
      ) : (
        <form className="feedback-form" onSubmit={submit}>
          <p id="feedback-privacy" className="feedback-privacy">
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
              maxLength={5000}
              rows={7}
              placeholder="What should Purple do better?"
            />
          </label>

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

          <TurnstileFormEnd
            action="purple_feedback"
            resetKey={resetKey}
            onToken={acceptTurnstileToken}
            onError={rejectTurnstileToken}
            error={turnstileError}
          >
            <DialogSubmitActions
              disabled={!message.trim() || !turnstileToken || submitting}
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

function feedbackError(status: number): string {
  if (status === 400 || status === 413) {
    return 'Check the form fields and keep the note under 5,000 characters.'
  }
  if (status === 403) return 'Bot protection expired or failed. Please retry.'
  return 'Purple could not deliver the note. Please try again in a moment.'
}
