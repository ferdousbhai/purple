import {
  isShareId,
  parsePatternSort,
  parseSharedPattern,
  parseSharedPatternDraft,
  PATTERN_PAGE_SIZE,
  type PatternSort,
  type SharedPattern,
} from '@purple/core/shared-pattern'
import {
  isJsonNumber,
  isJsonString,
  jsonMembers,
  jsonText,
  type JsonValue,
} from '@purple/core/json'
import { base64url, hasContentType, jsonResponse, readBoundedBody } from './http'
import {
  type SiteverifyFetch,
  turnstileFailureResponse,
  verifyTurnstile,
} from './turnstile'

const SHARE_ACTION = 'purple_share'
const MAX_SHARE_REQUEST_BYTES = 36_000
const MAX_VOTE_REQUEST_BYTES = 128
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048
const VOTER_COOKIE = 'purple_voter'
const VOTER_ID = /^[a-f0-9]{32}$/
const VOTER_MAX_AGE = 60 * 60 * 24 * 365

type PatternEnv = Pick<
  Env,
  'PATTERNS_DB' | 'SHARE_RATE_LIMITER' | 'TURNSTILE_SECRET' | 'VOTE_RATE_LIMITER'
>

interface PatternRow {
  id: string
  title: string
  code: string
  createdAt: number
  likes: number
  dislikes: number
  score: number
  viewerVote: number
}

interface VoteRow {
  likes: number
  dislikes: number
  score: number
  viewerVote: number
}

interface Voter {
  id: string
  hash: string
  setCookie?: string
}

interface FreshCursor {
  sort: 'fresh'
  createdAt: number
  id: string
}

interface TopCursor {
  sort: 'top'
  score: number
  likes: number
  createdAt: number
  id: string
}

type PageCursor = FreshCursor | TopCursor

interface PageQuery {
  sql: string
  bindings: Array<number | string>
}

export async function handlePatternRequest(
  request: Request,
  env: PatternEnv,
  siteverifyFetch: SiteverifyFetch = fetch,
): Promise<Response> {
  const requestId = crypto.randomUUID()
  try {
    const url = new URL(request.url)
    if (url.pathname === '/api/shares') {
      return request.method === 'POST'
        ? createShare(request, env, siteverifyFetch, requestId)
        : methodNotAllowed('POST')
    }
    if (url.pathname === '/api/patterns') {
      return request.method === 'GET'
        ? listPatterns(request, env)
        : methodNotAllowed('GET')
    }

    const shareMatch = /^\/api\/shares\/([^/]+)$/.exec(url.pathname)
    if (shareMatch) {
      return request.method === 'GET'
        ? getPattern(request, env, shareMatch[1] ?? '')
        : methodNotAllowed('GET')
    }

    const voteMatch = /^\/api\/patterns\/([^/]+)\/vote$/.exec(url.pathname)
    if (voteMatch) {
      return request.method === 'PUT'
        ? voteOnPattern(request, env, voteMatch[1] ?? '')
        : methodNotAllowed('PUT')
    }
    return jsonResponse({ error: 'Not found.' }, 404)
  } catch (error) {
    console.error(JSON.stringify({
      event: 'pattern_api_failed',
      requestId,
      errorName: error instanceof Error ? error.name : 'NonError',
    }))
    return jsonResponse({ error: 'Pattern service is unavailable.' }, 503)
  }
}

async function createShare(
  request: Request,
  env: PatternEnv,
  siteverifyFetch: SiteverifyFetch,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url)
  const requestFailure = mutationRequestFailure(request, url)
  if (requestFailure) return requestFailure

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rateLimit = await env.SHARE_RATE_LIMITER.limit({ key: ip })
  if (!rateLimit.success) return rateLimited()

  const body = await readJson(request, MAX_SHARE_REQUEST_BYTES)
  const fields = jsonMembers(body)
  const draft = parseSharedPatternDraft(body)
  const turnstileToken = jsonText(fields?.get('turnstileToken')) ?? ''
  if (
    !draft ||
    turnstileToken.length < 1 ||
    turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH
  ) {
    return jsonResponse({ error: 'Invalid shared pattern.' }, 400)
  }

  const turnstile = await verifyTurnstile(
    turnstileToken,
    SHARE_ACTION,
    url.hostname,
    request.headers.get('CF-Connecting-IP'),
    env.TURNSTILE_SECRET,
    siteverifyFetch,
    requestId,
  )
  const verificationFailure = turnstileFailureResponse(turnstile)
  if (verificationFailure) return verificationFailure

  const createdAt = Date.now()
  let id = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    id = randomShareId()
    try {
      await env.PATTERNS_DB.prepare(
        `INSERT INTO shared_patterns (id, title, code, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(id, draft.title, draft.code, createdAt).run()
      break
    } catch (error) {
      if (attempt === 2) throw error
    }
  }

  console.log(JSON.stringify({ event: 'pattern_shared', requestId, id }))
  return jsonResponse(
    { id },
    201,
    { Location: `/?s=${id}` },
  )
}

async function getPattern(
  request: Request,
  env: PatternEnv,
  id: string,
): Promise<Response> {
  if (!isShareId(id)) return jsonResponse({ error: 'Pattern not found.' }, 404)
  const voter = await getVoter(request)
  const row = await env.PATTERNS_DB.prepare(
    `${PATTERN_SELECT}
     WHERE p.id = ? AND p.hidden = 0`,
  ).bind(voter.hash, id).first<PatternRow>()
  const pattern = row && parsePatternRow(row)
  if (!pattern) return voterResponse(voter, { error: 'Pattern not found.' }, 404)
  return voterResponse(voter, { ...pattern }, 200)
}

async function listPatterns(request: Request, env: PatternEnv): Promise<Response> {
  const url = new URL(request.url)
  const sort = parsePatternSort(url.searchParams.get('sort'))
  const cursorValue = url.searchParams.get('cursor')
  const cursor = cursorValue ? decodeCursor(cursorValue, sort) : null
  if (cursorValue && !cursor) {
    return jsonResponse({ error: 'Invalid page cursor.' }, 400)
  }

  const voter = await getVoter(request)
  const query = pageQuery(sort, cursor)
  const result = await env.PATTERNS_DB.prepare(query.sql)
    .bind(voter.hash, ...query.bindings, PATTERN_PAGE_SIZE + 1)
    .all<PatternRow>()
  const parsed: SharedPattern[] = []
  for (const row of result.results) {
    const pattern = parsePatternRow(row)
    if (!pattern) throw new Error('D1 returned an invalid shared pattern row.')
    parsed.push(pattern)
  }
  const patterns = parsed.slice(0, PATTERN_PAGE_SIZE)
  const lastPattern = patterns.at(-1)
  const nextCursor = parsed.length > PATTERN_PAGE_SIZE && lastPattern
    ? encodeCursor(sort, lastPattern)
    : null
  return voterResponse(voter, {
    patterns: patterns.map((pattern) => ({ ...pattern })),
    nextCursor,
  }, 200)
}

async function voteOnPattern(
  request: Request,
  env: PatternEnv,
  id: string,
): Promise<Response> {
  const url = new URL(request.url)
  const requestFailure = mutationRequestFailure(request, url)
  if (requestFailure) return requestFailure
  if (!isShareId(id)) return jsonResponse({ error: 'Pattern not found.' }, 404)

  const voter = await getVoter(request)
  const rateLimit = await env.VOTE_RATE_LIMITER.limit({
    key: voteRateLimitKey(request, voter.id),
  })
  if (!rateLimit.success) return voterResponse(voter, { error: 'Too many votes.' }, 429, {
    'Retry-After': '60',
  })

  const body = await readJson(request, MAX_VOTE_REQUEST_BYTES)
  const value = patternVote(jsonMembers(body)?.get('value'))
  if (value === null) {
    return voterResponse(voter, { error: 'Invalid vote.' }, 400)
  }

  const voteStatement = value === 0
    ? env.PATTERNS_DB.prepare(
        `DELETE FROM pattern_votes
         WHERE pattern_id = ? AND voter_hash = ?
           AND EXISTS (
             SELECT 1 FROM shared_patterns WHERE id = ? AND hidden = 0
           )`,
      ).bind(id, voter.hash, id)
    : env.PATTERNS_DB.prepare(
        `INSERT INTO pattern_votes (pattern_id, voter_hash, value, updated_at)
         SELECT ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM shared_patterns WHERE id = ? AND hidden = 0
         )
         ON CONFLICT (pattern_id, voter_hash) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      ).bind(id, voter.hash, value, Date.now(), id)

  const results = await env.PATTERNS_DB.batch<VoteRow>([
    voteStatement,
    env.PATTERNS_DB.prepare(
      `UPDATE shared_patterns SET (likes, dislikes, score) = (
         SELECT
           COALESCE(SUM(value = 1), 0),
           COALESCE(SUM(value = -1), 0),
           COALESCE(SUM(value), 0)
         FROM pattern_votes
         WHERE pattern_id = ?
       )
       WHERE id = ? AND hidden = 0`,
    ).bind(id, id),
    env.PATTERNS_DB.prepare(
      `SELECT p.likes, p.dislikes, p.score, COALESCE(v.value, 0) AS viewerVote
       FROM shared_patterns p
       LEFT JOIN pattern_votes v ON v.pattern_id = p.id AND v.voter_hash = ?
       WHERE p.id = ? AND p.hidden = 0`,
    ).bind(voter.hash, id),
  ])
  const row = results[2]?.results[0]
  if (!row) return voterResponse(voter, { error: 'Pattern not found.' }, 404)
  const viewerVote = patternVote(row.viewerVote)
  if (
    !isNonNegativeInteger(row.likes) ||
    !isNonNegativeInteger(row.dislikes) ||
    !isSignedInteger(row.score) ||
    viewerVote === null
  ) throw new Error('D1 returned an invalid vote result.')

  return voterResponse(voter, {
    likes: row.likes,
    dislikes: row.dislikes,
    score: row.score,
    viewerVote,
  }, 200)
}

function voteRateLimitKey(request: Request, voterId: string): string {
  const connectingIp = request.headers.get('CF-Connecting-IP')?.trim()
  return connectingIp ? `ip:${connectingIp}` : `voter:${voterId}`
}

const PATTERN_SELECT = `SELECT
  p.id,
  p.title,
  p.code,
  p.created_at AS createdAt,
  p.likes,
  p.dislikes,
  p.score,
  COALESCE(v.value, 0) AS viewerVote
FROM shared_patterns p
LEFT JOIN pattern_votes v ON v.pattern_id = p.id AND v.voter_hash = ?`

function pageQuery(
  sort: PatternSort,
  cursor: PageCursor | null,
): PageQuery {
  if (sort === 'top') {
    const top = cursor?.sort === 'top' ? cursor : null
    const cursorClause = top
      ? `AND (
          p.score < ? OR
          (p.score = ? AND p.likes < ?) OR
          (p.score = ? AND p.likes = ? AND p.created_at < ?) OR
          (p.score = ? AND p.likes = ? AND p.created_at = ? AND p.id < ?)
        )`
      : ''
    const bindings = top
      ? [
          top.score,
          top.score, top.likes,
          top.score, top.likes, top.createdAt,
          top.score, top.likes, top.createdAt, top.id,
        ]
      : []
    return {
      sql: `${PATTERN_SELECT}
        WHERE p.hidden = 0 ${cursorClause}
        ORDER BY p.score DESC, p.likes DESC, p.created_at DESC, p.id DESC
        LIMIT ?`,
      bindings,
    }
  }

  const fresh = cursor?.sort === 'fresh' ? cursor : null
  const cursorClause = fresh
    ? 'AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))'
    : ''
  return {
    sql: `${PATTERN_SELECT}
      WHERE p.hidden = 0 ${cursorClause}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ?`,
    bindings: fresh ? [fresh.createdAt, fresh.createdAt, fresh.id] : [],
  }
}

function encodeCursor(sort: PatternSort, pattern: SharedPattern): string {
  const cursor: PageCursor = sort === 'top'
    ? {
        sort,
        score: pattern.score,
        likes: pattern.likes,
        createdAt: pattern.createdAt,
        id: pattern.id,
      }
    : { sort, createdAt: pattern.createdAt, id: pattern.id }
  return btoa(JSON.stringify(cursor))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function decodeCursor(value: string, sort: PatternSort): PageCursor | null {
  if (!/^[A-Za-z0-9_-]{1,400}$/.test(value)) return null
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const parsed: JsonValue = JSON.parse(atob(padded))
    const fields = jsonMembers(parsed)
    if (
      jsonText(fields?.get('sort')) !== sort ||
      !isShareIdValue(fields?.get('id')) ||
      !isNonNegativeInteger(fields?.get('createdAt'))
    ) return null
    const id = jsonText(fields.get('id'))
    const createdAt = jsonNumber(fields.get('createdAt'))
    if (!id || createdAt === null) return null
    if (sort === 'fresh') {
      return { sort, createdAt, id }
    }
    if (
      !isSignedInteger(fields.get('score')) ||
      !isNonNegativeInteger(fields.get('likes'))
    ) return null
    const score = jsonNumber(fields.get('score'))
    const likes = jsonNumber(fields.get('likes'))
    if (score === null || likes === null) return null
    return {
      sort,
      score,
      likes,
      createdAt,
      id,
    }
  } catch {
    return null
  }
}

async function readJson(request: Request, limit: number): Promise<JsonValue> {
  const body = await readBoundedBody(request, limit)
  if (!body.ok) return null
  try {
    const parsed: JsonValue = JSON.parse(body.body)
    return parsed
  } catch {
    return null
  }
}

function mutationRequestFailure(request: Request, url: URL): Response | null {
  if (request.headers.get('Origin') !== url.origin) {
    return jsonResponse({ error: 'Cross-origin submissions are not allowed.' }, 403)
  }
  return hasContentType(request, 'application/json')
    ? null
    : jsonResponse({ error: 'Unsupported request format.' }, 415)
}

function randomShareId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(9)))
}

async function getVoter(request: Request): Promise<Voter> {
  const existing = parseCookie(request.headers.get('Cookie'), VOTER_COOKIE)
  const id = existing && VOTER_ID.test(existing)
    ? existing
    : randomHex(16)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return {
    id,
    hash,
    setCookie: id === existing
      ? undefined
      : `${VOTER_COOKIE}=${id}; Path=/; Max-Age=${VOTER_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
  }
}

function parseCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim()
    }
  }
  return null
}

function randomHex(byteLength: number): string {
  return [...crypto.getRandomValues(new Uint8Array(byteLength))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function voterResponse(
  voter: Voter,
  body: JsonValue,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(body, status, voter.setCookie
    ? { ...headers, 'Set-Cookie': voter.setCookie }
    : headers)
}

function methodNotAllowed(allow: string): Response {
  return jsonResponse({ error: 'Method not allowed.' }, 405, { Allow: allow })
}

function rateLimited(): Response {
  return jsonResponse(
    { error: 'Too many requests.' },
    429,
    { 'Retry-After': '60' },
  )
}

function isShareIdValue(value: JsonValue | undefined): value is string {
  return isJsonString(value) && isShareId(value)
}

function isNonNegativeInteger(value: JsonValue | undefined): value is number {
  return isJsonNumber(value) && Number.isInteger(value) && value >= 0
}

function isSignedInteger(value: JsonValue | undefined): value is number {
  return isJsonNumber(value) && Number.isInteger(value)
}

function jsonNumber(value: JsonValue | undefined): number | null {
  return isJsonNumber(value) ? value : null
}

function patternVote(value: JsonValue | undefined): -1 | 0 | 1 | null {
  return value === -1 || value === 0 || value === 1 ? value : null
}

function parsePatternRow(row: PatternRow): SharedPattern | null {
  return parseSharedPattern({
    id: row.id,
    title: row.title,
    code: row.code,
    createdAt: row.createdAt,
    likes: row.likes,
    dislikes: row.dislikes,
    score: row.score,
    viewerVote: row.viewerVote,
  })
}
