/**
 * Browser-based pairing for agents that speak MCP authorization: point a
 * client at /mcp, and it opens this site in the person's browser, where the
 * studio already holds the pairing code. One Allow click hands the agent a
 * token that carries that code, so the relay needs no accounts and no
 * tables. Every artifact (client id, authorization code, access token) is an
 * HMAC-signed payload under TOKEN_SECRET; nothing is stored server-side.
 *
 * Authorization codes are therefore replayable for their five-minute life,
 * which is harmless: PKCE binds each code to the client holding the
 * verifier, and a replay yields another token for the same tab.
 */
import {
  isJsonNumber,
  isJsonString,
  jsonText,
  parseJsonMembers,
  type JsonValue,
} from '@purple/core/json'
import { isPairingCode } from './agent-relay'
import { base64url, hasContentType, jsonResponse, readBoundedBody } from './http'

export const MCP_PATH = '/mcp'
export const AUTHORIZE_PATH = '/authorize'
const REGISTER_PATH = '/oauth/register'
const TOKEN_PATH = '/oauth/token'
const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'
const SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server'

const MAX_REQUEST_BYTES = 8_000
const MAX_CLIENT_NAME_LENGTH = 100
const MAX_REDIRECT_URIS = 10
const CODE_TTL_SECONDS = 5 * 60
const ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/
/** RFC 7636 verifiers use the unreserved set, so "." and "~" are legal. */
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/
const DEFAULT_CLIENT_NAME = 'An MCP client'

export type OAuthEnv = Pick<Env, 'TOKEN_SECRET'>

export function isOAuthPath(pathname: string): boolean {
  return (
    pathname === REGISTER_PATH ||
    pathname === TOKEN_PATH ||
    pathname === AUTHORIZE_PATH ||
    pathname === RESOURCE_METADATA_PATH ||
    pathname.startsWith(`${RESOURCE_METADATA_PATH}/`) ||
    pathname === SERVER_METADATA_PATH
  )
}

/** Everything under the OAuth surface except the /authorize page, which is the studio. */
export async function handleOAuthRequest(
  request: Request,
  env: OAuthEnv,
): Promise<Response> {
  const url = new URL(request.url)
  const { pathname, origin } = url
  if (pathname === SERVER_METADATA_PATH) {
    return jsonResponse({
      issuer: origin,
      authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
      token_endpoint: `${origin}${TOKEN_PATH}`,
      registration_endpoint: `${origin}${REGISTER_PATH}`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    }, 200)
  }
  if (pathname.startsWith(RESOURCE_METADATA_PATH)) {
    return jsonResponse({
      resource: `${origin}${MCP_PATH}`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
    }, 200)
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, { Allow: 'POST' })
  }
  if (pathname === REGISTER_PATH) return registerClient(request, env)
  if (pathname === TOKEN_PATH) return issueToken(request, env)
  if (pathname === AUTHORIZE_PATH) return decideAuthorization(request, env)
  return jsonResponse({ error: 'Not found.' }, 404)
}

/** The pairing code a bearer token carries, or null when the caller must authorize. */
export async function bearerPairingCode(
  request: Request,
  env: OAuthEnv,
): Promise<string | null> {
  const header = request.headers.get('Authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const payload = await verifySigned(env.TOKEN_SECRET, header.slice(7).trim(), 'access')
  const code = jsonText(payload?.get('code'))
  return code !== null && isPairingCode(code) ? code : null
}

/** What an agent gets on /mcp without a valid token: the pointer to metadata. */
export function unauthorizedResponse(request: Request): Response {
  const origin = new URL(request.url).origin
  return jsonResponse({ error: 'Authorization required.' }, 401, {
    'WWW-Authenticate':
      `Bearer resource_metadata="${origin}${RESOURCE_METADATA_PATH}"`,
  })
}

/** Dynamic client registration: the client id is its own signed metadata. */
async function registerClient(request: Request, env: OAuthEnv): Promise<Response> {
  if (!hasContentType(request, 'application/json')) {
    return oauthError('invalid_client_metadata', 'Expected JSON.')
  }
  const body = await readBoundedBody(request, MAX_REQUEST_BYTES)
  const fields = body.ok ? parseJsonMembers(body.body) : null
  if (!fields) return oauthError('invalid_client_metadata', 'Unreadable metadata.')

  const uris = fields.get('redirect_uris')
  const redirectUris = Array.isArray(uris) ? uris.filter(isJsonString) : []
  if (
    redirectUris.length === 0 ||
    redirectUris.length > MAX_REDIRECT_URIS ||
    !redirectUris.every(isAcceptableRedirectUri)
  ) {
    return oauthError('invalid_redirect_uri', 'Redirect URIs must be https, or http on localhost.')
  }
  const name = (jsonText(fields.get('client_name')) ?? DEFAULT_CLIENT_NAME)
    .trim()
    .slice(0, MAX_CLIENT_NAME_LENGTH) || DEFAULT_CLIENT_NAME

  const clientId = await sign(env.TOKEN_SECRET, {
    kind: 'client',
    name,
    redirect_uris: redirectUris,
  })
  return jsonResponse({
    client_id: clientId,
    client_id_issued_at: nowSeconds(),
    client_name: name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  }, 201)
}

/** Display-only: the name a client registered, for the consent page. */
export function clientDisplayName(clientId: string): string {
  const payload = decodeUnverified(clientId)
  return jsonText(payload?.get('name')) ?? DEFAULT_CLIENT_NAME
}

/**
 * The studio's Allow or Deny, posted from the /authorize page with the
 * browser's own pairing code. Answers with where to send the browser next.
 */
async function decideAuthorization(request: Request, env: OAuthEnv): Promise<Response> {
  const url = new URL(request.url)
  if (request.headers.get('Origin') !== url.origin) {
    return jsonResponse({ error: 'Cross-origin decisions are not allowed.' }, 403)
  }
  if (!hasContentType(request, 'application/json')) {
    return jsonResponse({ error: 'Expected JSON.' }, 415)
  }
  const body = await readBoundedBody(request, MAX_REQUEST_BYTES)
  const fields = body.ok ? parseJsonMembers(body.body) : null
  if (!fields) return jsonResponse({ error: 'Unreadable decision.' }, 400)

  const clientId = jsonText(fields.get('client_id')) ?? ''
  const redirectUri = jsonText(fields.get('redirect_uri')) ?? ''
  const state = jsonText(fields.get('state'))
  const challenge = jsonText(fields.get('code_challenge')) ?? ''
  const method = jsonText(fields.get('code_challenge_method')) ?? 'plain'
  const pairingCode = jsonText(fields.get('pairing_code')) ?? ''
  const decision = jsonText(fields.get('decision'))

  const client = await verifySigned(env.TOKEN_SECRET, clientId, 'client')
  const registeredUris = client?.get('redirect_uris')
  if (
    !client ||
    !Array.isArray(registeredUris) ||
    !registeredUris.includes(redirectUri)
  ) {
    return jsonResponse({ error: 'Unknown client or redirect URI.' }, 400)
  }
  if (!isPairingCode(pairingCode)) {
    return jsonResponse({ error: 'This browser has no pairing code.' }, 400)
  }
  const target = new URL(redirectUri)
  if (state !== null) target.searchParams.set('state', state)

  if (decision !== 'allow') {
    target.searchParams.set('error', 'access_denied')
    return jsonResponse({ redirect: target.toString() }, 200)
  }
  if (method !== 'S256' || !PKCE_CHALLENGE.test(challenge)) {
    target.searchParams.set('error', 'invalid_request')
    target.searchParams.set('error_description', 'PKCE S256 is required.')
    return jsonResponse({ redirect: target.toString() }, 200)
  }
  target.searchParams.set('code', await sign(env.TOKEN_SECRET, {
    kind: 'code',
    code: pairingCode,
    client: await sha256Hex(clientId),
    redirect_uri: redirectUri,
    challenge,
    exp: nowSeconds() + CODE_TTL_SECONDS,
  }))
  return jsonResponse({ redirect: target.toString() }, 200)
}

/** Authorization code plus PKCE verifier in, bearer token out. */
async function issueToken(request: Request, env: OAuthEnv): Promise<Response> {
  if (!hasContentType(request, 'application/x-www-form-urlencoded')) {
    return oauthError('invalid_request', 'Expected a form-encoded body.')
  }
  const body = await readBoundedBody(request, MAX_REQUEST_BYTES)
  if (!body.ok) return oauthError('invalid_request', 'Request is too large.')
  const form = new URLSearchParams(body.body)
  if (form.get('grant_type') !== 'authorization_code') {
    return oauthError('unsupported_grant_type', 'Only authorization_code is supported.')
  }
  const grant = await verifySigned(env.TOKEN_SECRET, form.get('code') ?? '', 'code')
  const verifier = form.get('code_verifier') ?? ''
  if (
    !grant ||
    !isFresh(grant) ||
    grant.get('client') !== await sha256Hex(form.get('client_id') ?? '') ||
    grant.get('redirect_uri') !== (form.get('redirect_uri') ?? '') ||
    !PKCE_VERIFIER.test(verifier) ||
    grant.get('challenge') !== await pkceChallenge(verifier)
  ) {
    return oauthError('invalid_grant', 'The authorization code is invalid or expired.')
  }
  const code = jsonText(grant.get('code'))
  if (code === null || !isPairingCode(code)) {
    return oauthError('invalid_grant', 'The authorization code is invalid or expired.')
  }
  return jsonResponse({
    access_token: await sign(env.TOKEN_SECRET, {
      kind: 'access',
      code,
      exp: nowSeconds() + ACCESS_TTL_SECONDS,
    }),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
  }, 200)
}

function isAcceptableRedirectUri(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash) return false
  if (url.protocol === 'https:') return true
  return (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
}

function oauthError(error: string, description: string): Response {
  return jsonResponse({ error, error_description: description }, 400)
}

function isFresh(payload: ReadonlyMap<string, JsonValue>): boolean {
  const exp = payload.get('exp')
  return isJsonNumber(exp) && exp > nowSeconds()
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// Signed payloads: base64url(JSON) "." base64url(HMAC-SHA256).

async function sign(secret: string, payload: { [key: string]: JsonValue }): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body))
  return `${body}.${base64url(new Uint8Array(signature))}`
}

async function verifySigned(
  secret: string,
  token: string,
  kind: 'client' | 'code' | 'access',
): Promise<ReadonlyMap<string, JsonValue> | null> {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const signature = fromBase64url(token.slice(dot + 1))
  if (signature === null) return null
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    new TextEncoder().encode(body),
  )
  if (!valid) return null
  const payload = decodeUnverified(token)
  if (!payload || payload.get('kind') !== kind) return null
  if (kind !== 'client' && !isFresh(payload)) return null
  return payload
}

function decodeUnverified(token: string): ReadonlyMap<string, JsonValue> | null {
  const bytes = fromBase64url(token.split('.', 1)[0] ?? '')
  return bytes === null ? null : parseJsonMembers(new TextDecoder().decode(bytes))
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

/** Test seam: the S256 challenge for a verifier, as a client computes it. */
export { pkceChallenge as computePkceChallenge }
