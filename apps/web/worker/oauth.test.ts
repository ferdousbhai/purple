import { describe, expect, it } from 'vitest'
import {
  bearerPairingCode,
  clientDisplayName,
  computePkceChallenge,
  handleOAuthRequest,
  unauthorizedResponse,
} from './oauth'

const env = { TOKEN_SECRET: 'test-secret' }
const ORIGIN = 'https://soundspurple.com'
const PAIRING_CODE = '0f7c2d91aa34bb56cc78'
const REDIRECT = 'http://localhost:53000/callback'
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

type JsonBody = { [key: string]: string | string[] | null }

function json(path: string, body: JsonBody, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function form(path: string, fields: Record<string, string>): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })
}

async function register(): Promise<{ client_id: string }> {
  const response = await handleOAuthRequest(
    json('/oauth/register', { client_name: 'Claude Code', redirect_uris: [REDIRECT] }),
    env,
  )
  expect(response.status).toBe(201)
  return response.json()
}

async function authorize(clientId: string, decision = 'allow'): Promise<URL> {
  const response = await handleOAuthRequest(
    json('/authorize', {
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: 'xyz',
      code_challenge: await computePkceChallenge(VERIFIER),
      code_challenge_method: 'S256',
      pairing_code: PAIRING_CODE,
      decision,
    }, { Origin: ORIGIN }),
    env,
  )
  expect(response.status).toBe(200)
  const { redirect } = await response.json<{ redirect: string }>()
  return new URL(redirect)
}

describe('metadata', () => {
  it('points agents from the resource to the authorization server', async () => {
    const resource = await handleOAuthRequest(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
      env,
    )
    expect(await resource.json()).toMatchObject({
      resource: `${ORIGIN}/mcp`,
      authorization_servers: [ORIGIN],
    })
    const server = await handleOAuthRequest(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      env,
    )
    expect(await server.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    })
  })

  it('names the metadata in the 401 challenge', () => {
    const response = unauthorizedResponse(new Request(`${ORIGIN}/mcp`, { method: 'POST' }))
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
    )
  })
})

describe('registration', () => {
  it('issues a client id that carries its own name and redirect URIs', async () => {
    const client = await register()
    expect(clientDisplayName(client.client_id)).toBe('Claude Code')
  })

  it('rejects redirect URIs that are neither https nor local http', async () => {
    const response = await handleOAuthRequest(
      json('/oauth/register', { redirect_uris: ['http://example.com/cb'] }),
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' })
  })
})

describe('authorization code flow', () => {
  it('turns one Allow into a bearer token for the pairing code', async () => {
    const { client_id } = await register()
    const redirect = await authorize(client_id)
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT)
    expect(redirect.searchParams.get('state')).toBe('xyz')
    const code = redirect.searchParams.get('code')
    expect(code).not.toBeNull()

    const token = await handleOAuthRequest(
      form('/oauth/token', {
        grant_type: 'authorization_code',
        code: code ?? '',
        redirect_uri: REDIRECT,
        client_id,
        code_verifier: VERIFIER,
      }),
      env,
    )
    expect(token.status).toBe(200)
    const { access_token, token_type } = await token.json<{ access_token: string; token_type: string }>()
    expect(token_type).toBe('Bearer')

    const call = new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(await bearerPairingCode(call, env)).toBe(PAIRING_CODE)
  })

  it('sends Deny back to the client as access_denied', async () => {
    const { client_id } = await register()
    const redirect = await authorize(client_id, 'deny')
    expect(redirect.searchParams.get('error')).toBe('access_denied')
    expect(redirect.searchParams.get('code')).toBeNull()
  })

  it('refuses a code without the matching verifier, client, or redirect', async () => {
    const { client_id } = await register()
    const code = (await authorize(client_id)).searchParams.get('code') ?? ''
    const attempts = [
      { code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier-wrong' },
      { client_id: `${client_id}x` },
      { redirect_uri: 'http://localhost:53000/other' },
    ]
    for (const override of attempts) {
      const response = await handleOAuthRequest(
        form('/oauth/token', {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT,
          client_id,
          code_verifier: VERIFIER,
          ...override,
        }),
        env,
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'invalid_grant' })
    }
  })

  it('only accepts decisions posted from the site itself', async () => {
    const { client_id } = await register()
    const response = await handleOAuthRequest(
      json('/authorize', { client_id, redirect_uri: REDIRECT, decision: 'allow' }),
      env,
    )
    expect(response.status).toBe(403)
  })

  it('ignores tokens signed under another secret or forged', async () => {
    const forged = new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer eyJraW5kIjoiYWNjZXNzIn0.bm9wZQ' },
    })
    expect(await bearerPairingCode(forged, env)).toBeNull()
  })
})
