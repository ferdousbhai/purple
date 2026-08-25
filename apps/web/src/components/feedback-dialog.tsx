import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

const TURNSTILE_SCRIPT_ID = 'purple-turnstile-script'
const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
const TURNSTILE_PRODUCTION_SITE_KEY = '0x4AAAAAAEahuZIY1bbd6u2g'
const TURNSTILE_ACTION = 'purple_feedback'

const TURNSTILE_SITE_KEY = import.meta.env.DEV
  ? TURNSTILE_TEST_SITE_KEY
  : TURNSTILE_PRODUCTION_SITE_KEY

interface TurnstileOptions {
  sitekey: string
  action: string
  appearance: 'interaction-only'
  size: 'flexible'
  theme: 'auto'
  callback: (token: string) => void
  'error-callback': () => void
  'expired-callback': () => void
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string
  remove(widgetId: string): void
  reset(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let turnstileLoad: Promise<TurnstileApi> | null = null

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
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

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const close = () => {
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    else onClose()
  }

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
    <dialog
      ref={dialogRef}
      className="feedback-dialog"
      aria-labelledby="feedback-title"
      aria-describedby="feedback-privacy"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <header className="feedback-head">
        <div>
          <span>FEEDBACK</span>
          <h2 id="feedback-title">Send a note to Ferdous</h2>
        </div>
        <button type="button" aria-label="Close feedback" onClick={close}>
          ×
        </button>
      </header>

      {submitted ? (
        <section className="feedback-success" role="status">
          <strong>MESSAGE SENT</strong>
          <p>Thanks. Your note reached my inbox.</p>
          <button type="button" className="primary" onClick={close}>DONE</button>
        </section>
      ) : (
        <form className="feedback-form" onSubmit={submit}>
          <p id="feedback-privacy" className="feedback-privacy">
            Only this form is sent to Purple. Do not include your Gemini key, prompts,
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

          <TurnstileWidget
            resetKey={resetKey}
            onToken={acceptTurnstileToken}
            onError={rejectTurnstileToken}
          />

          {turnstileError ? <p className="error" role="alert">{turnstileError}</p> : null}
          {submitError ? <p className="error" role="alert">{submitError}</p> : null}

          <div className="feedback-actions">
            <button type="button" className="chrome" onClick={close}>CANCEL</button>
            <button
              className="primary"
              disabled={!message.trim() || !turnstileToken || submitting}
            >
              {submitting ? 'SENDING…' : 'SEND FEEDBACK'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}

function TurnstileWidget(props: {
  resetKey: number
  onToken: (token: string) => void
  onError: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const previousResetKeyRef = useRef(props.resetKey)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return

    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return
        widgetIdRef.current = turnstile.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          action: TURNSTILE_ACTION,
          appearance: 'interaction-only',
          size: 'flexible',
          theme: 'auto',
          callback: props.onToken,
          'error-callback': props.onError,
          'expired-callback': props.onError,
        })
      })
      .catch(props.onError)

    return () => {
      cancelled = true
      const widgetId = widgetIdRef.current
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
      widgetIdRef.current = null
    }
  }, [props.onError, props.onToken])

  useEffect(() => {
    if (previousResetKeyRef.current === props.resetKey) return
    previousResetKeyRef.current = props.resetKey
    const widgetId = widgetIdRef.current
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId)
  }, [props.resetKey])

  return <div className="feedback-turnstile" ref={containerRef} aria-label="Bot protection" />
}

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (turnstileLoad) return turnstileLoad

  turnstileLoad = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID)
    const script = existing instanceof HTMLScriptElement
      ? existing
      : document.createElement('script')

    const loaded = () => {
      if (window.turnstile) resolve(window.turnstile)
      else {
        turnstileLoad = null
        script.remove()
        reject(new Error('Turnstile loaded without its browser API.'))
      }
    }
    const failed = () => {
      turnstileLoad = null
      script.remove()
      reject(new Error('Turnstile could not load.'))
    }

    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', failed, { once: true })
    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })

  return turnstileLoad
}

function feedbackError(status: number): string {
  if (status === 400 || status === 413) {
    return 'Check the form fields and keep the note under 5,000 characters.'
  }
  if (status === 403) return 'Bot protection expired or failed. Please retry.'
  return 'Purple could not deliver the note. Please try again in a moment.'
}
