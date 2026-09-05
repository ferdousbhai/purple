import type {
  PatternSort,
  PatternVote,
  PatternVoteResult,
  SharedPattern,
} from '@purple/core/shared-pattern'
import { PurpleMark } from '@purple/ui/purple-mark'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InternalLink, type NavigateInApp } from './internal-link'
import { unlockMediaChannel } from '#/lib/media-channel'
import {
  removePattern,
  sharedLibraryId,
  upsertPattern,
  usePatterns,
} from '#/lib/patterns'
import type { WebPlayback } from '#/lib/playback'
import { fetchPatternPage, voteForPattern } from '#/lib/public-patterns'

const PATTERN_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
})

export interface PatternsPageProps {
  focusOnMount?: boolean
  navigate?: NavigateInApp
  /** Owned by the route so audio survives navigation between pages. */
  playback: WebPlayback
}

export function PatternsPage({ focusOnMount, navigate, playback }: PatternsPageProps) {
  const [sort, setSort] = useState<PatternSort>('fresh')
  const [patterns, setPatterns] = useState<SharedPattern[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [votePending, setVotePending] = useState<Set<string>>(() => new Set())
  const loadMoreControllerRef = useRef<AbortController | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const library = usePatterns()
  const savedPatternsByShareId = useMemo(
    () => new Map(
      library.flatMap((pattern) =>
        pattern.shareId ? [[pattern.shareId, pattern] as const] : [],
      ),
    ),
    [library],
  )
  const playbackActive =
    playback.playbackState === 'playing' ||
    playback.playbackState === 'loading' ||
    playback.playbackState === 'transitioning'

  useEffect(() => {
    if (focusOnMount) mainRef.current?.focus({ preventScroll: true })
  }, [focusOnMount])

  useEffect(() => {
    const controller = new AbortController()
    loadMoreControllerRef.current?.abort()
    loadMoreControllerRef.current = null
    setLoading(true)
    setLoadingMore(false)
    setPatterns([])
    setNextCursor(null)
    setError(null)
    setLoadError(false)
    void fetchPatternPage(sort, null, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setPatterns(page.patterns)
        setNextCursor(page.nextCursor)
      })
      .catch((reason: Error) => {
        if (reason.name === 'AbortError') return
        setLoadError(true)
        setError('Purple could not load public patterns. Please try again.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      const loadMoreController = loadMoreControllerRef.current
      loadMoreController?.abort()
      if (loadMoreControllerRef.current === loadMoreController) {
        loadMoreControllerRef.current = null
      }
    }
  }, [loadAttempt, sort])

  const updatePattern = useCallback((id: string, update: PatternVoteResult) => {
    setPatterns((current) => current.map((pattern) =>
      pattern.id === id ? { ...pattern, ...update } : pattern,
    ))
  }, [])

  const vote = async (pattern: SharedPattern, value: PatternVote): Promise<boolean> => {
    if (votePending.has(pattern.id)) return false
    setVotePending((current) => new Set(current).add(pattern.id))
    setError(null)
    try {
      const result = await voteForPattern(pattern.id, value)
      updatePattern(pattern.id, result)
      return true
    } catch {
      setError('Purple could not record that vote. Please try again.')
      return false
    } finally {
      setVotePending((current) => {
        const next = new Set(current)
        next.delete(pattern.id)
        return next
      })
    }
  }

  const toggleLike = async (pattern: SharedPattern) => {
    if (votePending.has(pattern.id)) return
    const saved = savedPatternsByShareId.get(pattern.id)
    const liked = pattern.viewerVote === 1
    let persisted = true
    let rollbackLibrary: (() => boolean) | null = null
    if (liked) {
      if (saved) {
        persisted = removePattern(saved.id)
        rollbackLibrary = () => upsertPattern(saved)
      }
    } else if (!saved) {
      const now = Date.now()
      const nextPattern = {
        id: sharedLibraryId(pattern.id),
        title: pattern.title,
        code: pattern.code,
        shareId: pattern.id,
        createdAt: now,
        updatedAt: now,
      }
      persisted = upsertPattern(nextPattern)
      rollbackLibrary = () => removePattern(nextPattern.id)
    }
    if (!persisted) {
      setError('This browser could not update your library. Allow site data and try again.')
      return
    }
    if (!(await vote(pattern, liked ? 0 : 1)) && rollbackLibrary && !rollbackLibrary()) {
      setError('Purple could not record that vote or restore your library. Please try again.')
    }
  }

  const toggleDislike = async (pattern: SharedPattern) => {
    if (votePending.has(pattern.id)) return
    const saved = savedPatternsByShareId.get(pattern.id)
    const disliked = pattern.viewerVote === -1
    if (!disliked && saved && !removePattern(saved.id)) {
      setError('This browser could not update your library. Allow site data and try again.')
      return
    }
    if (!(await vote(pattern, disliked ? 0 : -1)) && !disliked && saved) {
      if (!upsertPattern(saved)) {
        setError('Purple could not record that vote or restore your library. Please try again.')
      }
    }
  }

  const togglePlayback = (pattern: SharedPattern) => {
    // Start the hidden media channel in the click itself for iOS WebKit.
    unlockMediaChannel()
    const active = playback.activeCode === pattern.code && playbackActive
    if (active) {
      playback.stop()
      return
    }
    void playback.play(pattern.code)
  }

  const loadMore = async () => {
    if (!nextCursor || loadingMore || loadMoreControllerRef.current) return
    const controller = new AbortController()
    loadMoreControllerRef.current = controller
    setLoadingMore(true)
    setError(null)
    try {
      const page = await fetchPatternPage(sort, nextCursor, controller.signal)
      if (controller.signal.aborted) return
      setPatterns((current) => {
        const seen = new Set(current.map(({ id }) => id))
        return [
          ...current,
          ...page.patterns.filter(({ id }) => {
            if (seen.has(id)) return false
            seen.add(id)
            return true
          }),
        ]
      })
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (reason instanceof Error && reason.name === 'AbortError') return
      setError('Purple could not load more patterns. Please try again.')
    } finally {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null
        setLoadingMore(false)
      }
    }
  }

  return (
    <main
      className="patterns-shell"
      ref={mainRef}
      tabIndex={focusOnMount ? -1 : undefined}
    >
      <header className="topbar patterns-topbar">
        <InternalLink className="brand" href="/" navigate={navigate} aria-label="Purple studio">
          <PurpleMark className="brand-mark" />
          <span className="brand-name">PURPLE</span>
        </InternalLink>
        <nav className="topbar-actions" aria-label="Primary">
          <span className="chrome open" aria-current="page">PATTERNS</span>
          <InternalLink className="primary patterns-studio-link" href="/" navigate={navigate}>
            BACK TO STUDIO
          </InternalLink>
        </nav>
      </header>

      <section className="patterns-content">
        <header className="patterns-intro">
          <div className="patterns-intro-copy">
            <h1>PUBLIC PATTERNS</h1>
            <p>Listen in any browser. Vote for keepers, open any pattern in the studio.</p>
          </div>
          <div className="pattern-sort" role="group" aria-label="Sort patterns">
            <button
              className={sort === 'fresh' ? 'active' : ''}
              aria-pressed={sort === 'fresh'}
              onClick={() => setSort('fresh')}
            >
              FRESH
            </button>
            <button
              className={sort === 'top' ? 'active' : ''}
              aria-pressed={sort === 'top'}
              onClick={() => setSort('top')}
            >
              TOP
            </button>
          </div>
        </header>

        {error ? (
          <div className="error patterns-error" role="alert">
            <span>{error}</span>
            {loadError ? (
              <button
                className="chrome"
                onClick={() => setLoadAttempt((current) => current + 1)}
              >
                RETRY
              </button>
            ) : null}
          </div>
        ) : null}
        {playback.error ? (
          <p className="error patterns-error" role="alert">{playback.error}</p>
        ) : null}

        {loading ? (
          <p className="patterns-status" role="status">LOADING PATTERNS…</p>
        ) : loadError ? null : patterns.length === 0 ? (
          <section className="patterns-empty">
            <p>No public patterns yet.</p>
            <InternalLink className="primary" href="/" navigate={navigate}>
              MAKE THE FIRST ONE
            </InternalLink>
          </section>
        ) : (
          <section className="pattern-card-grid" aria-label="Public patterns">
            {patterns.map((pattern) => {
              const playing = playback.activeCode === pattern.code && playbackActive
              const liked = pattern.viewerVote === 1
              return (
                <article className={`pattern-card ${playing ? 'playing' : ''}`} key={pattern.id}>
                  <div className="pattern-card-preview">
                    <header>
                      <h2>{pattern.title}</h2>
                      <time dateTime={new Date(pattern.createdAt).toISOString()}>
                        {formatDate(pattern.createdAt)}
                      </time>
                    </header>
                    <pre>{pattern.code}</pre>
                  </div>
                  <footer>
                    <div className="pattern-card-actions">
                      <button
                        className={`card-play ${playing ? 'stop' : ''}`}
                        aria-label={`${playing ? 'Stop' : 'Play'} ${pattern.title}`}
                        onClick={() => togglePlayback(pattern)}
                      >
                        {playing ? '■ STOP' : '▶ PLAY'}
                      </button>
                      <InternalLink
                        className="card-open"
                        href={`/?s=${pattern.id}`}
                        navigate={navigate}
                        aria-label={`Open ${pattern.title} in studio`}
                      >
                        OPEN IN STUDIO
                      </InternalLink>
                    </div>
                    <div className="pattern-votes">
                      <button
                        className={liked ? 'active like' : 'like'}
                        aria-label={`${liked ? 'Unlike' : 'Like'} ${pattern.title}`}
                        aria-pressed={liked}
                        disabled={votePending.has(pattern.id)}
                        onClick={() => void toggleLike(pattern)}
                      >
                        <ThumbIcon />
                        <span>{pattern.likes}</span>
                      </button>
                      <button
                        className={pattern.viewerVote === -1 ? 'active dislike' : 'dislike'}
                        aria-label={`${pattern.viewerVote === -1 ? 'Remove dislike from' : 'Dislike'} ${pattern.title}`}
                        aria-pressed={pattern.viewerVote === -1}
                        disabled={votePending.has(pattern.id)}
                        onClick={() => void toggleDislike(pattern)}
                      >
                        <ThumbIcon down />
                        <span>{pattern.dislikes}</span>
                      </button>
                    </div>
                  </footer>
                </article>
              )
            })}
          </section>
        )}

        {nextCursor && !loading ? (
          <button
            className="chrome load-more"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'LOADING…' : 'LOAD MORE'}
          </button>
        ) : null}
      </section>
    </main>
  )
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={down ? 'thumb-down' : undefined}
    >
      <path
        d="M7 10v10H3V10h4Zm2 10V9.2L12.4 3c.3-.6 1-.9 1.6-.6.7.3 1.1 1 1 1.7L14.6 8H20c1.2 0 2.1 1.1 1.9 2.3l-1.5 8c-.2 1-1 1.7-2 1.7H9Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function formatDate(value: number): string {
  return PATTERN_DATE_FORMAT.format(value)
}
