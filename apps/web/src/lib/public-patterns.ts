import {
  isShareId,
  parsePatternVoteResult,
  parseSharedPattern,
  parseSharedPatternPage,
  type PatternSort,
  type PatternVote,
  type PatternVoteResult,
  type SharedPattern,
  type SharedPatternDraft,
  type SharedPatternPage,
} from '@purple/core/shared-pattern'
import { jsonMembers, jsonText, type JsonValue } from '@purple/core/json'

export async function fetchSharedPattern(
  id: string,
  signal?: AbortSignal,
): Promise<SharedPattern> {
  if (!isShareId(id)) throw new Error('That shared pattern link is invalid.')
  const response = await fetch(`/api/shares/${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
    signal,
  })
  const body = await responseBody(response)
  const pattern = parseSharedPattern(body)
  if (!response.ok || !pattern) throw apiError(response, body)
  return pattern
}

export async function fetchPatternPage(
  sort: PatternSort,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<SharedPatternPage> {
  const search = new URLSearchParams({ sort })
  if (cursor) search.set('cursor', cursor)
  const response = await fetch(`/api/patterns?${search}`, {
    headers: { accept: 'application/json' },
    signal,
  })
  const body = await responseBody(response)
  const page = parseSharedPatternPage(body)
  if (!response.ok || !page) throw apiError(response, body)
  return page
}

export async function createSharedPattern(
  draft: SharedPatternDraft,
  turnstileToken: string,
): Promise<string> {
  const response = await fetch('/api/shares', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...draft, turnstileToken }),
  }).catch(() => {
    throw new Error('Purple could not reach the public pattern service.')
  })
  const body = await responseBody(response)
  const id = jsonText(jsonMembers(body)?.get('id'))
  if (!response.ok || !id || !isShareId(id)) {
    throw new Error(
      sharePublishError(response.status, jsonText(jsonMembers(body)?.get('error'))),
    )
  }
  return id
}

/** Visitor-facing reason a public publish failed. */
export function sharePublishError(
  status: number,
  serverMessage: string | null,
): string {
  if (status === 429) return 'Too many shares from this network. Wait a minute.'
  if (status === 404 || status === 405) {
    return 'Pattern service is not running in this dev server.'
  }
  if (status === 403) return 'Bot protection expired or failed. Please retry.'
  if (serverMessage) return serverMessage
  return 'Purple could not reach the public pattern service.'
}

/** Put the share link in the address bar, or clear it, without remounting the studio. */
export function syncSharedPatternUrl(id: string | null): void {
  if (window.location.pathname !== '/') return
  if (id !== null && !isShareId(id)) return
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('s', id)
  else url.searchParams.delete('s')
  const next = `${url.pathname}${url.search}`
  const current = `${window.location.pathname}${window.location.search}`
  if (next !== current) window.history.replaceState(window.history.state, '', next)
  document.title = id
    ? 'Shared Strudel Pattern | Purple'
    : 'Purple: AI Music Production with Strudel'
}

export async function voteForPattern(
  id: string,
  value: PatternVote,
): Promise<PatternVoteResult> {
  if (!isShareId(id)) throw new Error('That shared pattern link is invalid.')
  const response = await fetch(`/api/patterns/${encodeURIComponent(id)}/vote`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ value }),
  })
  const body = await responseBody(response)
  const result = parsePatternVoteResult(body)
  if (!response.ok || !result) throw apiError(response, body)
  return result
}

export function sharedPatternUrl(id: string): string {
  const url = new URL('/', window.location.origin)
  url.searchParams.set('s', id)
  return url.href
}

async function responseBody(response: Response): Promise<JsonValue> {
  try {
    const body: JsonValue = await response.json()
    return body
  } catch {
    return null
  }
}

function apiError(response: Response, body: JsonValue): Error {
  const serverMessage = jsonText(jsonMembers(body)?.get('error'))
  const fallback = response.status === 404
    ? 'That shared pattern could not be found.'
    : 'Purple could not reach the public pattern service.'
  return new Error(serverMessage ?? fallback)
}
