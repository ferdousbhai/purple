import { DEFAULT_HANDLE, MAX_HANDLE_LENGTH, MAX_SHARED_TITLE_LENGTH } from '@purple/core/shared-pattern'
import { useClipboardCopy } from '@purple/ui/use-clipboard-copy'
import { useState, type FormEvent } from 'react'
import {
  createSharedPattern,
  sharedPatternUrl,
} from '#/lib/public-patterns'
import { InternalLink, type NavigateInApp } from './internal-link'
import { DialogSubmitActions, ModalDialog } from './modal-dialog'
import { TurnstileFormEnd, useTurnstile } from './turnstile-widget'

export function ShareDialog(props: {
  code: string
  existingId: string | null
  navigate?: NavigateInApp
  onClose: () => void
  onShared: (id: string, title: string) => void
  republish: boolean
  title: string
}) {
  const [title, setTitle] = useState(props.title)
  const [handle, setHandle] = useState(loadHandle)
  const [sharedId, setSharedId] = useState(props.existingId)
  const turnstile = useTurnstile()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const clipboard = useClipboardCopy()

  const nextTitle = title.trim()
  const nextHandle = handle.trim()
  const titled = Boolean(nextTitle)
  const url = sharedId ? sharedPatternUrl(sharedId) : null
  const canShare = url !== null && browserCanShare(url)
  const errorAlert = submitError
    ? <p className="error" role="alert">{submitError}</p>
    : null

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!nextTitle || !turnstile.token || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const id = await createSharedPattern(
        { title: nextTitle, code: props.code, handle: nextHandle || null },
        turnstile.token,
      )
      saveHandle(nextHandle)
      setSharedId(id)
      props.onShared(id, nextTitle)
    } catch (reason) {
      setSubmitError(
        reason instanceof Error && reason.message
          ? reason.message
          : 'Purple could not publish this pattern. Please try again in a moment.',
      )
      turnstile.reset()
    } finally {
      setSubmitting(false)
    }
  }
  const copyLink = async () => {
    if (!url) return
    if (!(await clipboard.copy(url))) {
      setSubmitError('Copy was blocked. Select the link and copy it manually.')
    }
  }
  const sendLink = async () => {
    if (!url || !canShare) return
    try {
      await navigator.share({ title: nextTitle, url })
    } catch (reason) {
      if (reason instanceof Error && reason.name === 'AbortError') return
      setSubmitError('Sharing was blocked. Copy the link instead.')
    }
  }

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
            <div className="share-link-actions">
              {canShare ? (
                <button type="button" className="chrome" onClick={() => void sendLink()}>
                  SHARE
                </button>
              ) : null}
              <button type="button" className="primary" onClick={() => void copyLink()}>
                {clipboard.copied ? 'COPIED' : 'COPY LINK'}
              </button>
            </div>
          </div>
          {errorAlert}
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
            {props.republish
              ? 'This publishes a new public pattern. The previous share link stays as it was.'
              : 'Sharing publishes this title and pattern code to Purple’s public gallery.'}
            {' '}
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
          {errorAlert}
          <TurnstileFormEnd action="purple_share" turnstile={turnstile}>
            <DialogSubmitActions
              checking={titled && turnstile.waiting}
              disabled={!titled || !turnstile.token || submitting}
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

function browserCanShare(url: string): boolean {
  try {
    if (navigator.canShare) return navigator.canShare({ url })
    return Boolean(navigator.share)
  } catch {
    return false
  }
}
