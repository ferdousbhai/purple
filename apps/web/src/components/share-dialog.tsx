import { DEFAULT_HANDLE, MAX_HANDLE_LENGTH, MAX_SHARED_TITLE_LENGTH } from '@purple/core/shared-pattern'
import { useClipboardCopy } from '@purple/ui/use-clipboard-copy'
import { useCallback, useState, type FormEvent } from 'react'
import {
  createSharedPattern,
  sharedPatternUrl,
} from '#/lib/public-patterns'
import { InternalLink, type NavigateInApp } from './internal-link'
import { DialogSubmitActions, ModalDialog } from './modal-dialog'
import { TurnstileFormEnd } from './turnstile-widget'

export function ShareDialog(props: {
  code: string
  existingId: string | null
  navigate?: NavigateInApp
  onClose: () => void
  onShared: (id: string, title: string) => void
  title: string
}) {
  const [title, setTitle] = useState(props.title)
  const [handle, setHandle] = useState(loadHandle)
  const [sharedId, setSharedId] = useState(props.existingId)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clipboard = useClipboardCopy()

  const acceptToken = useCallback((token: string) => {
    setTurnstileToken(token)
    setError(null)
  }, [])
  const rejectToken = useCallback(() => {
    setTurnstileToken('')
    setError('Bot protection could not verify this browser. Please retry.')
  }, [])

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim() || !turnstileToken || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const id = await createSharedPattern(
        { title: title.trim(), code: props.code, handle: handle.trim() || null },
        turnstileToken,
      )
      saveHandle(handle.trim())
      setSharedId(id)
      props.onShared(id, title.trim())
    } catch {
      setError('Purple could not publish this pattern. Please try again in a moment.')
      setTurnstileToken('')
      setResetKey((key) => key + 1)
    } finally {
      setSubmitting(false)
    }
  }

  const copyLink = async () => {
    if (!sharedId) return
    if (!(await clipboard.copy(sharedPatternUrl(sharedId)))) {
      setError('Copy was blocked. Select the link and copy it manually.')
    }
  }

  const url = sharedId ? sharedPatternUrl(sharedId) : null
  return (
    <ModalDialog
      className="feedback-dialog"
      dismissible={!submitting}
      titleId="share-title"
      descriptionId="share-privacy"
      title="Share this pattern"
      closeLabel="Close sharing"
      onClose={props.onClose}
    >
      {(close) => url ? (
        <section className="share-success" role="status">
          <p id="share-privacy">
            This pattern is published, and anyone with the link can play it.
          </p>
          <div className="share-link-row">
            <input aria-label="Shared pattern link" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="primary" onClick={copyLink}>
              {clipboard.copied ? 'COPIED' : 'COPY LINK'}
            </button>
          </div>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="feedback-actions">
            <InternalLink className="chrome" href="/patterns" navigate={props.navigate}>
              BROWSE PATTERNS
            </InternalLink>
            <button type="button" className="primary" onClick={close}>DONE</button>
          </div>
        </section>
      ) : (
        <form className="feedback-form" onSubmit={publish}>
          <p id="share-privacy" className="feedback-privacy">
            Sharing publishes this title and pattern code to Purple’s public gallery.
            Do not include private information in either field.
          </p>
          <label>
            <span>PATTERN TITLE</span>
            <input
              autoFocus
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={MAX_SHARED_TITLE_LENGTH}
            />
          </label>
          <label>
            <span>HANDLE <small>OPTIONAL</small></span>
            <input
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              maxLength={MAX_HANDLE_LENGTH}
              placeholder={DEFAULT_HANDLE}
            />
          </label>
          <TurnstileFormEnd
            action="purple_share"
            resetKey={resetKey}
            onToken={acceptToken}
            onError={rejectToken}
            error={error}
          >
            <DialogSubmitActions
              disabled={!title.trim() || !turnstileToken || submitting}
              idleLabel="PUBLISH PATTERN"
              onCancel={close}
              pending={submitting}
              pendingLabel="PUBLISHING…"
            />
          </TurnstileFormEnd>
        </form>
      )}
    </ModalDialog>
  )
}

const HANDLE_KEY = 'purple-handle'

function loadHandle(): string {
  try {
    return localStorage.getItem(HANDLE_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveHandle(handle: string): void {
  try {
    if (handle) localStorage.setItem(HANDLE_KEY, handle)
    else localStorage.removeItem(HANDLE_KEY)
  } catch {
    // Remembering the handle is a convenience only.
  }
}
