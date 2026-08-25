import { useEffect, useRef, type ReactNode } from 'react'

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

export function TurnstileFormEnd(props: {
  action: string
  children: ReactNode
  error: string | null
  onError: () => void
  onToken: (token: string) => void
  resetKey: number
}) {
  return (
    <>
      <TurnstileWidget
        action={props.action}
        resetKey={props.resetKey}
        onToken={props.onToken}
        onError={props.onError}
      />
      {props.error ? <p className="error" role="alert">{props.error}</p> : null}
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
  }, [props.action, props.onError, props.onToken])

  useEffect(() => {
    if (previousResetKeyRef.current === props.resetKey) return
    previousResetKeyRef.current = props.resetKey
    const widgetId = widgetIdRef.current
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId)
  }, [props.resetKey])

  return <div className="turnstile-widget" ref={containerRef} aria-label="Bot protection" />
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
