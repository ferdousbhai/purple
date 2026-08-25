import type {
  PatternSort,
  PatternVote,
  PatternVoteResult,
  SharedPattern,
} from '@purple/core/shared-pattern'
import { PurpleMark } from '@purple/ui/purple-mark'
import { usePlayback } from '@purple/ui/use-playback'
import { useCallback, useEffect, useRef, useState } from 'react'
import { unlockMediaChannel } from '#/lib/media-channel'
import {
  removePattern,
  sharedLibraryId,
  upsertPattern,
  usePatterns,
} from '#/lib/patterns'
import { WEB_AUDIO_OPTIONS } from '#/lib/playback'
import { fetchPatternPage, voteForPattern } from '#/lib/public-patterns'

const PATTERN_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
})

export function PatternsPage() {
  const [sort, setSort] = useState<PatternSort>('fresh')
  const [patterns, setPatterns] = useState<SharedPattern[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [votePending, setVotePending] = useState<Set<string>>(() => new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const loadMoreControllerRef = useRef<AbortController | null>(null)
  const playback = usePlayback(WEB_AUDIO_OPTIONS)
  const library = usePatterns()
  const playbackActive =
    playback.playbackState === 'playing' ||
    playback.playbackState === 'loading' ||
    playback.playbackState === 'transitioning'

  useEffect(() => {
    const controller = new AbortController()
    loadMoreControllerRef.current?.abort()
    loadMoreControllerRef.current = null
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    void fetchPatternPage(sort, null, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setPatterns(page.patterns)
        setNextCursor(page.nextCursor)
      })
      .catch((reason: Error) => {
        if (reason.name === 'AbortError') return
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
  }, [sort])

  const updatePattern = useCallback((id: string, update: PatternVoteResult) => {
    setPatterns((current) => current.map((pattern) =>
      pattern.id === id ? { ...pattern, ...update } : pattern,
    ))
  }, [])

  const vote = async (pattern: SharedPattern, value: PatternVote) => {
    if (votePending.has(pattern.id)) return
    setVotePending((current) => new Set(current).add(pattern.id))
    setError(null)
    try {
      const result = await voteForPattern(pattern.id, value)
      updatePattern(pattern.id, result)
    } catch {
      setError('Purple could not record that vote. Please try again.')
    } finally {
      setVotePending((current) => {
        const next = new Set(current)
        next.delete(pattern.id)
        return next
      })
    }
  }

  const toggleLike = async (pattern: SharedPattern) => {
    const saved = library.find((candidate) => candidate.shareId === pattern.id)
    const liked = pattern.viewerVote === 1 || saved !== undefined
    let persisted = true
    if (liked) {
      if (saved) persisted = removePattern(saved.id)
    } else {
      const now = Date.now()
      persisted = upsertPattern({
        id: sharedLibraryId(pattern.id),
        title: pattern.title,
        code: pattern.code,
        shareId: pattern.id,
        createdAt: now,
        updatedAt: now,
      })
    }
    if (!persisted) {
      setError('This browser could not update your library. Allow site data and try again.')
      return
    }
    await vote(pattern, liked ? 0 : 1)
  }

  const toggleDislike = async (pattern: SharedPattern) => {
    const saved = library.find((candidate) => candidate.shareId === pattern.id)
    if (saved && !removePattern(saved.id)) {
      setError('This browser could not update your library. Allow site data and try again.')
      return
    }
    await vote(pattern, pattern.viewerVote === -1 ? 0 : -1)
  }

  const togglePlayback = (pattern: SharedPattern) => {
    // Start the hidden media channel in the click itself for iOS WebKit.
    unlockMediaChannel()
    const active = activeId === pattern.id && playbackActive
    if (active) {
      playback.stop()
      setActiveId(null)
      return
    }
    setActiveId(pattern.id)
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
      setPatterns((current) => [...current, ...page.patterns])
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
    <main className="patterns-shell">
      <header className="topbar patterns-topbar">
        <a className="brand" href="/" aria-label="Purple studio">
          <PurpleMark className="brand-mark" />
          <span className="brand-name">PURPLE</span>
        </a>
        <nav className="topbar-actions" aria-label="Primary">
          <span className="chrome open" aria-current="page">PATTERNS</span>
          <a className="chrome" href="/">OPEN STUDIO</a>
        </nav>
      </header>

      <section className="patterns-content">
        <header className="patterns-intro">
          <div>
            <p>PUBLIC PATTERNS</p>
            <h1>Press play. Keep what you like.</h1>
            <span>Playback works without a Gemini key. Open a card to edit it in Purple.</span>
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

        {error ? <p className="error patterns-error" role="alert">{error}</p> : null}
        {playback.error ? (
          <p className="error patterns-error" role="alert">{playback.error}</p>
        ) : null}

        {loading ? (
          <p className="patterns-status" role="status">LOADING PATTERNS…</p>
        ) : patterns.length === 0 ? (
          <section className="patterns-empty">
            <p>No public patterns yet.</p>
            <a className="primary" href="/">MAKE THE FIRST ONE</a>
          </section>
        ) : (
          <section className="pattern-card-grid" aria-label="Public patterns">
            {patterns.map((pattern) => {
              const playing = activeId === pattern.id && playbackActive
              const saved = library.some((candidate) => candidate.shareId === pattern.id)
              const liked = pattern.viewerVote === 1 || saved
              return (
                <article className={`pattern-card ${playing ? 'playing' : ''}`} key={pattern.id}>
                  <a
                    className="pattern-card-open"
                    href={`/?s=${pattern.id}`}
                    aria-label={`Open ${pattern.title} in studio`}
                  >
                    <header>
                      <h2>{pattern.title}</h2>
                      <time dateTime={new Date(pattern.createdAt).toISOString()}>
                        {formatDate(pattern.createdAt)}
                      </time>
                    </header>
                    <pre>{pattern.code}</pre>
                    <span className="open-hint">OPEN IN STUDIO ↗</span>
                  </a>
                  <footer>
                    <button
                      className={`card-play ${playing ? 'stop' : ''}`}
                      aria-label={`${playing ? 'Stop' : 'Play'} ${pattern.title}`}
                      onClick={() => togglePlayback(pattern)}
                    >
                      {playing ? '■ STOP' : '▶ PLAY'}
                    </button>
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
