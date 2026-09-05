/**
 * Hosted agent link: lets a visitor's MCP agent play their Purple tab with
 * zero installs. The agent speaks Streamable HTTP MCP to /mcp/<code>; the
 * tab holds a WebSocket to /link/<code>; a Durable Object named by the code
 * relays agent-link frames between them and matches responses by id. The
 * pairing code is generated in the visitor's browser and shown only to them,
 * and the relay carries nothing but session state and pattern code.
 */

import {
  decodeAgentHello,
  decodeAgentResponse,
  decodeAgentRequest,
  encodeAgentRequest,
  LINK_TAKEN_OVER_CODE,
  type AgentCall,
} from '@purple/core/agent-link'
import {
  AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  formatAgentToolResult,
  NOT_CONNECTED_MESSAGE,
  pairingGuide,
  planAgentToolCall,
  SHARE_NEEDS_RELAY_MESSAGE,
} from '@purple/core/agent-tools'
import { errorMessage } from '@purple/core/error'
import {
  parseSharedPatternDraft,
  type SharedPatternDraft,
} from '@purple/core/shared-pattern'
import {
  isJsonNumber,
  isJsonString,
  jsonMembers,
  jsonText,
  parseJsonMembers,
  type JsonValue,
} from '@purple/core/json'
import { hasContentType, jsonResponse, readBoundedBody, textResponse } from './http'
import { publishSharedPattern } from './patterns'

/** Codes are minted by the studio (20 hex chars); accept a little latitude. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{12,64}$/
/** A pattern is at most 30k chars; JSON-RPC framing stays well under this. */
const MAX_MCP_REQUEST_BYTES = 100_000
const SUPPORTED_MCP_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
const LATEST_MCP_VERSION = '2025-06-18'
const MAX_RELAY_TIMEOUT_MS = 180_000
/** Workers WebSocket readyState for an open socket. */
const SOCKET_OPEN = 1

type AgentCallOutcome =
  | { ok: true; result: JsonValue }
  | { ok: false; error: string }

export type AgentCaller = (
  call: AgentCall,
  timeoutMs: number,
) => Promise<AgentCallOutcome>

export type PatternPublisher = (
  draft: SharedPatternDraft,
) => Promise<{ ok: true; url: string } | { ok: false; error: string }>

type RelayEnv = Pick<Env, 'AGENT_LINK' | 'PATTERNS_DB' | 'SHARE_RATE_LIMITER'>

export function isPairingCode(value: string): boolean {
  return CODE_PATTERN.test(value)
}

export function agentLinkCodeFromPath(
  pathname: string,
  prefix: string,
): string | null {
  const code = pathname.slice(prefix.length)
  return isPairingCode(code) ? code : null
}

/** The tab side: upgrade the studio's WebSocket into the code's session. */
export async function handleAgentLinkUpgrade(
  request: Request,
  env: RelayEnv,
  code: string | null,
): Promise<Response> {
  if (code === null) return jsonResponse({ error: 'Invalid link code.' }, 404)
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return jsonResponse({ error: 'Expected a WebSocket upgrade.' }, 426)
  }
  const stub = env.AGENT_LINK.get(env.AGENT_LINK.idFromName(code))
  return stub.fetch(new Request('https://agent-link/connect', request))
}

/**
 * What an agent that guessed the URL, or a person reading its error, sees:
 * where the endpoint is and that the code only comes from an open tab.
 * 404 without a usable code; 405 for anything but POST with one, since the
 * relay opens no server-initiated stream and keeps no session to delete.
 */
export function mcpEndpointHelp(request: Request, code: string | null): Response {
  const origin = new URL(request.url).origin
  const guessing = code === null
  return textResponse(
    `Purple MCP endpoint.\n\n${pairingGuide(origin)}\n\nMore: ${origin}/llms.txt\n`,
    guessing ? 404 : 405,
    guessing ? {} : { Allow: 'POST' },
  )
}

/** The agent side: one Streamable HTTP MCP endpoint per pairing code. */
export async function handleMcpRequest(
  request: Request,
  env: RelayEnv,
  code: string | null,
): Promise<Response> {
  if (code === null || request.method !== 'POST') {
    return mcpEndpointHelp(request, code)
  }
  if (!hasContentType(request, 'application/json')) {
    return jsonResponse({ error: 'Unsupported request format.' }, 415)
  }
  const body = await readBoundedBody(request, MAX_MCP_REQUEST_BYTES)
  if (!body.ok) return jsonResponse({ error: 'Request is too large.' }, 413)

  let message: JsonValue
  try {
    message = JSON.parse(body.body)
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'), 200)
  }

  const reply = await handleMcpMessage(
    message,
    (call, timeoutMs) => relayAgentCall(env, code, call, timeoutMs),
    (draft) => publishForTab(env, code, new URL(request.url).origin, draft),
  )
  return reply === null
    ? new Response(null, { status: 202 })
    : jsonResponse(reply, 200)
}

/**
 * Answer one JSON-RPC message: the response value, or null for notifications
 * (which get 202 and no body). Pure apart from the injected agent caller, so
 * tests can drive it without a Durable Object.
 */
export async function handleMcpMessage(
  message: JsonValue,
  callAgent: AgentCaller,
  publish: PatternPublisher | null = null,
): Promise<JsonValue | null> {
  const fields = jsonMembers(message)
  if (!fields || fields.get('jsonrpc') !== '2.0') {
    return rpcError(null, -32600, 'Invalid request')
  }
  const method = jsonText(fields.get('method'))
  if (method === null) return rpcError(null, -32600, 'Invalid request')

  const id = fields.get('id')
  const isNotification =
    id === undefined || (!isJsonString(id) && !isJsonNumber(id))
  if (method.startsWith('notifications/')) return null
  if (isNotification) return null

  const params = jsonMembers(fields.get('params') ?? null)
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: negotiatedVersion(params),
        capabilities: { tools: {} },
        serverInfo: { name: 'purple', version: '0.1.0' },
        instructions: AGENT_INSTRUCTIONS,
      })
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: AGENT_TOOLS })
    case 'tools/call':
      return callTool(id, params, callAgent, publish)
    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

async function callTool(
  id: JsonValue,
  params: ReadonlyMap<string, JsonValue> | null,
  callAgent: AgentCaller,
  publish: PatternPublisher | null,
): Promise<JsonValue> {
  const name = jsonText(params?.get('name'))
  if (name === null || !AGENT_TOOLS.some((tool) => tool.name === name)) {
    return rpcError(id, -32602, `Unknown tool: ${name ?? '(missing name)'}`)
  }
  const args = jsonMembers(params?.get('arguments') ?? null)
  try {
    const plan = planAgentToolCall(name, args)
    if (plan.kind === 'text') return toolText(id, plan.text)
    if (plan.kind === 'share') {
      if (publish === null) return toolText(id, SHARE_NEEDS_RELAY_MESSAGE, true)
      const session = await callAgent(plan.call, plan.timeoutMs)
      if (!session.ok) return toolText(id, session.error, true)
      const fields = jsonMembers(session.result)
      const draft = parseSharedPatternDraft({
        title: plan.title ?? jsonText(fields?.get('title')),
        code: jsonText(fields?.get('code')),
        handle: plan.handle,
      })
      if (draft === null) {
        return toolText(
          id,
          'Nothing publishable in the editor, or the title or handle is too long.',
          true,
        )
      }
      const published = await publish(draft)
      return published.ok
        ? toolText(id, `Published to the public feed: ${published.url}`)
        : toolText(id, published.error, true)
    }
    const outcome = await callAgent(plan.call, plan.timeoutMs)
    return outcome.ok
      ? toolText(id, formatAgentToolResult(plan.call, outcome.result))
      : toolText(id, outcome.error, true)
  } catch (cause) {
    return toolText(id, errorMessage(cause), true)
  }
}

function negotiatedVersion(
  params: ReadonlyMap<string, JsonValue> | null,
): string {
  const requested = jsonText(params?.get('protocolVersion'))
  return requested !== null && SUPPORTED_MCP_VERSIONS.includes(requested)
    ? requested
    : LATEST_MCP_VERSION
}

function rpcResult(id: JsonValue, result: JsonValue): JsonValue {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: JsonValue, code: number, text: string): JsonValue {
  return { jsonrpc: '2.0', id, error: { code, message: text } }
}

function toolText(id: JsonValue, text: string, isError = false): JsonValue {
  return rpcResult(id, {
    content: [{ type: 'text', text }],
    isError,
  })
}

async function relayAgentCall(
  env: RelayEnv,
  code: string,
  call: AgentCall,
  timeoutMs: number,
): Promise<AgentCallOutcome> {
  const stub = env.AGENT_LINK.get(env.AGENT_LINK.idFromName(code))
  const response = await stub.fetch('https://agent-link/call', {
    method: 'POST',
    body: JSON.stringify({
      timeoutMs,
      request: encodeAgentRequest({ id: crypto.randomUUID(), ...call }),
    }),
  })
  const fields = parseJsonMembers(await response.text())
  if (fields?.get('ok') === true) {
    const result = fields.get('result')
    if (result !== undefined) return { ok: true, result }
  }
  const error = jsonText(fields?.get('error'))
  return { ok: false, error: error ?? 'The relay returned an unusable answer.' }
}

/** An agent publishes on behalf of the tab it is paired with, so the tab's
 * pairing code is the rate-limit key: a real browser minted it. */
async function publishForTab(
  env: RelayEnv,
  code: string,
  origin: string,
  draft: SharedPatternDraft,
): ReturnType<PatternPublisher> {
  const rateLimit = await env.SHARE_RATE_LIMITER.limit({ key: `pair:${code}` })
  if (!rateLimit.success) {
    return { ok: false, error: 'Too many shares from this tab. Wait a minute.' }
  }
  const id = await publishSharedPattern(env, draft, crypto.randomUUID())
  return { ok: true, url: `${origin}/?s=${id}` }
}

/**
 * One pairing code's session. Holds the tab's hibernatable WebSocket and the
 * in-flight calls awaiting its answers; an in-flight /call keeps the object
 * awake, and an idle connected tab costs nothing.
 */
export class AgentLinkSession {
  private readonly pending = new Map<string, (outcome: AgentCallOutcome) => void>()

  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/connect') return this.connectTab()
    if (url.pathname === '/call' && request.method === 'POST') {
      return this.relayCall(await request.text())
    }
    return jsonResponse({ error: 'Not found.' }, 404)
  }

  private connectTab(): Response {
    // The newest tab wins: a reload or second window replaces the old link.
    for (const socket of this.state.getWebSockets()) {
      socket.close(LINK_TAKEN_OVER_CODE, 'Another Purple tab connected.')
    }
    this.failPending('The Purple tab was replaced by a new connection.')
    const pair = new WebSocketPair()
    this.state.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private tabSocket(): WebSocket | null {
    return (
      this.state
        .getWebSockets()
        .find((socket) => socket.readyState === SOCKET_OPEN) ?? null
    )
  }

  private async relayCall(body: string): Promise<Response> {
    const fields = parseJsonMembers(body)
    const timeoutMs = fields?.get('timeoutMs')
    const frameText = jsonText(fields?.get('request'))
    const frame = frameText === null ? null : decodeAgentRequest(frameText)
    if (
      frame === null ||
      frameText === null ||
      !isJsonNumber(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > MAX_RELAY_TIMEOUT_MS
    ) {
      return jsonResponse({ ok: false, error: 'Malformed relay call.' }, 400)
    }

    const tab = this.tabSocket()
    if (tab === null) {
      return jsonResponse({ ok: false, error: NOT_CONNECTED_MESSAGE }, 200)
    }

    const outcome = await new Promise<AgentCallOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id)
        resolve({
          ok: false,
          error:
            `Purple did not answer ${frame.method} within ` +
            `${Math.round(timeoutMs / 1000)} seconds.`,
        })
      }, timeoutMs)
      this.pending.set(frame.id, (settled) => {
        clearTimeout(timer)
        resolve(settled)
      })
      tab.send(frameText)
    })
    return jsonResponse(outcome, 200)
  }

  webSocketMessage(_socket: WebSocket, message: ArrayBuffer | string): void {
    // The studio only sends text frames; anything else stringifies into a
    // frame the decoders reject.
    const text = String(message)
    if (decodeAgentHello(text) !== null) return
    const response = decodeAgentResponse(text)
    if (response === null) return
    const settle = this.pending.get(response.id)
    if (settle === undefined) return
    this.pending.delete(response.id)
    settle(
      response.ok
        ? { ok: true, result: response.result }
        : { ok: false, error: response.error },
    )
  }

  webSocketClose(): void {
    if (this.tabSocket() === null) {
      this.failPending('The Purple tab disconnected before answering.')
    }
  }

  webSocketError(): void {
    this.webSocketClose()
  }

  private failPending(reason: string): void {
    for (const settle of this.pending.values()) {
      settle({ ok: false, error: reason })
    }
    this.pending.clear()
  }
}
