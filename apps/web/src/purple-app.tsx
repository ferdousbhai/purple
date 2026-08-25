import { isShareId, type SharedPattern } from '@purple/core/shared-pattern'
import { usePlayback } from '@purple/ui/use-playback'
import {
  lazy,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { InternalLink, type NavigateInApp } from '#/components/internal-link'
import { WEB_AUDIO_OPTIONS, type WebPlayback } from '#/lib/playback'
import { fetchSharedPattern } from '#/lib/public-patterns'

const PurpleStudio = lazy(async () => {
  const studio = await import('#/components/purple-studio')
  return { default: studio.PersistentPurpleStudio }
})
const PatternsPage = lazy(async () => {
  const patterns = await import('#/components/patterns-page')
  return { default: patterns.PersistentPatternsPage }
})

function StudioRoute(props: {
  id: string | null
  navigate: NavigateInApp
  playback: WebPlayback
}) {
  const { id } = props
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
        <InternalLink href="/patterns" navigate={props.navigate}>
          Browse public patterns
        </InternalLink>
      </RouteMessage>
    )
  }
  if (id && !pattern) {
    return (
      <main autoFocus className="boot-shell" tabIndex={-1}>
        LOADING PATTERN…
      </main>
    )
  }
  return (
    <Suspense fallback={(
      <main autoFocus className="boot-shell" tabIndex={-1}>
        LOADING STUDIO…
      </main>
    )}>
      <PurpleStudio
        focusOnMount
        navigate={props.navigate}
        playback={props.playback}
        sharedPattern={pattern ?? undefined}
      />
    </Suspense>
  )
}

function RouteMessage(props: { children?: ReactNode; message: string }) {
  return (
    <main autoFocus className="route-message" tabIndex={-1}>
      <h1>PURPLE</h1>
      <p role="alert">{props.message}</p>
      {props.children}
    </main>
  )
}

interface BrowserRoute {
  href: string
  pathname: string
  search: string
}

function currentBrowserRoute(): BrowserRoute {
  return {
    href: `${window.location.pathname}${window.location.search}`,
    pathname: window.location.pathname,
    search: window.location.search,
  }
}

function AppRoute(props: {
  navigate: NavigateInApp
  playback: WebPlayback
  route: BrowserRoute
}) {
  if (props.route.pathname === '/') {
    const id = new URLSearchParams(props.route.search).get('s')
    return (
      <StudioRoute
        id={id}
        key={props.route.href}
        navigate={props.navigate}
        playback={props.playback}
      />
    )
  }
  if (props.route.pathname === '/patterns') {
    return (
      <Suspense fallback={(
        <main autoFocus className="boot-shell" tabIndex={-1}>
          LOADING PATTERNS…
        </main>
      )}>
        <PatternsPage
          focusOnMount
          navigate={props.navigate}
          playback={props.playback}
        />
      </Suspense>
    )
  }
  return (
    <RouteMessage message="This page does not exist.">
      <InternalLink href="/" navigate={props.navigate}>
        Return to the studio
      </InternalLink>
    </RouteMessage>
  )
}

export function PurpleApp() {
  const playback = usePlayback(WEB_AUDIO_OPTIONS)
  const [route, setRoute] = useState(currentBrowserRoute)
  const navigate = useCallback<NavigateInApp>((href) => {
    const destination = new URL(href, window.location.origin)
    if (destination.origin !== window.location.origin) {
      window.location.assign(destination)
      return
    }
    const nextHref = `${destination.pathname}${destination.search}`
    if (nextHref !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState(null, '', nextHref)
    }
    setRoute(currentBrowserRoute())
    window.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    const updateRoute = () => setRoute(currentBrowserRoute())
    window.addEventListener('popstate', updateRoute)
    return () => window.removeEventListener('popstate', updateRoute)
  }, [])

  const routeLabel = browserRouteLabel(route)
  useEffect(() => {
    document.title = browserRouteTitle(route)
  }, [route])

  return (
    <>
      <span className="sr-only" role="status">{routeLabel}</span>
      <AppRoute navigate={navigate} playback={playback} route={route} />
    </>
  )
}

function browserRouteLabel(route: BrowserRoute): string {
  if (route.pathname === '/') {
    return new URLSearchParams(route.search).has('s')
      ? 'Shared pattern in Purple studio'
      : 'Purple studio'
  }
  if (route.pathname === '/patterns') return 'Public patterns'
  return 'Page not found'
}

function browserRouteTitle(route: BrowserRoute): string {
  if (route.pathname === '/') {
    return new URLSearchParams(route.search).has('s')
      ? 'Shared Strudel Pattern | Purple'
      : 'Purple: AI Music Production with Strudel'
  }
  if (route.pathname === '/patterns') return 'Public Strudel Patterns | Purple'
  return 'Page Not Found | Purple'
}
