import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const TURNSTILE_SCRIPT_ID = 'purple-turnstile-script'
const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
const TURNSTILE_PRODUCTION_SITE_KEY = '0x4AAAAAAEahuZIY1bbd6u2g'
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
  'before-interactive-callback': () => void
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

interface TurnstileField {
  token: string
  error: string | null
  resetKey: number
  waiting: boolean
  accept(token: string): void
  reject(): void
  reset(): void
}

/** Token, challenge error, and widget reset for a Turnstile-backed form. */
export function useTurnstile(): TurnstileField {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const accept = useCallback((next: string) => {
    setToken(next)
    setError(null)
  }, [])
  const reject = useCallback(() => {
    setToken('')
    setError('Bot protection could not verify this browser. Please retry.')
  }, [])
  const reset = useCallback(() => {
    setToken('')
    setResetKey((key) => key + 1)
  }, [])
  return {
    token,
    error,
    resetKey,
    waiting: !token && !error,
    accept,
    reject,
    reset,
  }
}

export function TurnstileFormEnd(props: {
  action: string
  children: ReactNode
  turnstile: TurnstileField
}) {
  return (
    <>
      <TurnstileWidget
        action={props.action}
        resetKey={props.turnstile.resetKey}
        onToken={props.turnstile.accept}
        onError={props.turnstile.reject}
      />
      {props.turnstile.error ? <p className="error" role="alert">{props.turnstile.error}</p> : null}
      <div className="feedback-actions">{props.children}</div>
    </>
  )
}

function TurnstileWidget(props: {
  action: string
  resetKey: number
  onToken: (token: string) => void
  onError: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const previousResetKeyRef = useRef(props.resetKey)
  const [interactive, setInteractive] = useState(false)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return

    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return
        widgetIdRef.current = turnstile.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          action: props.action,
          appearance: 'interaction-only',
          size: 'flexible',
          theme: 'auto',
          callback: (token) => {
            setInteractive(false)
            props.onToken(token)
          },
          'error-callback': props.onError,
          'expired-callback': props.onError,
          'before-interactive-callback': () => setInteractive(true),
        })
      })
      .catch(props.onError)

    return () => {
      cancelled = true
      const widgetId = widgetIdRef.current
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
      widgetIdRef.current = null
    }
  }, [props.action, props.onError, props.onToken])

  useEffect(() => {
    if (previousResetKeyRef.current === props.resetKey) return
    previousResetKeyRef.current = props.resetKey
    setInteractive(false)
    const widgetId = widgetIdRef.current
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId)
  }, [props.resetKey])

  return (
    <div
      className={interactive ? 'turnstile-widget interactive' : 'turnstile-widget'}
      ref={containerRef}
      aria-hidden={!interactive}
      aria-label={interactive ? 'Bot protection' : undefined}
    />
  )
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
