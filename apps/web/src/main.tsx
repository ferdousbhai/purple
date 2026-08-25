import { isShareId, type SharedPattern } from '@purple/core/shared-pattern'
import { Component, lazy, Suspense, type ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PurpleStudio } from '#/components/purple-studio'
import { fetchSharedPattern } from '#/lib/public-patterns'
import './styles.css'

const PatternsPage = lazy(async () => {
  const patterns = await import('#/components/patterns-page')
  return { default: patterns.PatternsPage }
})

interface CrashScreenState {
  error: Error | null
}

/** A render crash replaces the studio with the same message page routes used to show. */
class CrashScreen extends Component<{ children: ReactNode }, CrashScreenState> {
  state: CrashScreenState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="route-message">
          <h1>PURPLE</h1>
          <p role="alert">{this.state.error.message}</p>
          <a href="/">Reload the studio</a>
        </main>
      )
    }
    return this.props.children
  }
}

function StudioRoute() {
  const id = new URL(window.location.href).searchParams.get('s')
  const [pattern, setPattern] = useState<SharedPattern | null>(null)
  const [error, setError] = useState<string | null>(
    id && !isShareId(id) ? 'That shared pattern link is invalid.' : null,
  )

  useEffect(() => {
    if (!id || !isShareId(id)) return
    const controller = new AbortController()
    void fetchSharedPattern(id, controller.signal)
      .then(setPattern)
      .catch((reason: Error) => {
        if (reason.name === 'AbortError') return
        setError('That shared pattern could not be found.')
      })
    return () => controller.abort()
  }, [id])

  if (error) {
    return (
      <RouteMessage message={error}>
        <a href="/patterns">Browse public patterns</a>
      </RouteMessage>
    )
  }
  if (id && !pattern) return <main className="boot-shell">LOADING PATTERN…</main>
  return <PurpleStudio sharedPattern={pattern ?? undefined} />
}

function RouteMessage(props: { children?: ReactNode; message: string }) {
  return (
    <main className="route-message">
      <h1>PURPLE</h1>
      <p role="alert">{props.message}</p>
      {props.children}
    </main>
  )
}

function AppRoute() {
  if (window.location.pathname === '/') return <StudioRoute />
  if (window.location.pathname === '/patterns') {
    return (
      <Suspense fallback={<main className="boot-shell">LOADING PATTERNS…</main>}>
        <PatternsPage />
      </Suspense>
    )
  }
  return (
    <RouteMessage message="This page does not exist.">
      <a href="/">Return to the studio</a>
    </RouteMessage>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing the #root element.')

createRoot(root).render(
  <CrashScreen>
    <AppRoute />
  </CrashScreen>,
)
