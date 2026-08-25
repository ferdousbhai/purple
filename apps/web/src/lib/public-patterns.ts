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
  })
  const body = await responseBody(response)
  const id = jsonText(jsonMembers(body)?.get('id'))
  if (!response.ok || !id || !isShareId(id)) {
    throw apiError(response, body)
  }
  return id
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
