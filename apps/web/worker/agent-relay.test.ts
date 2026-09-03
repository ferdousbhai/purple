import { describe, expect, it, vi } from 'vitest'
import type { JsonValue } from '@purple/core/json'
import {
  agentLinkCodeFromPath,
  handleMcpMessage,
  type AgentCaller,
} from './agent-relay'

const neverCalled: AgentCaller = () => {
  throw new Error('The agent caller must not run for this message.')
}

function rpc(method: string, params?: JsonValue, id: JsonValue = 1): JsonValue {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params }
}

describe('agentLinkCodeFromPath', () => {
  it('accepts studio-minted codes and rejects everything else', () => {
    expect(agentLinkCodeFromPath('/mcp/0f7c2d91aa34bb56cc78', '/mcp/')).toBe(
      '0f7c2d91aa34bb56cc78',
    )
    expect(agentLinkCodeFromPath('/mcp/short', '/mcp/')).toBeNull()
    expect(agentLinkCodeFromPath('/mcp/../etc/passwd', '/mcp/')).toBeNull()
    expect(agentLinkCodeFromPath('/mcp/', '/mcp/')).toBeNull()
  })
})

describe('handleMcpMessage', () => {
  it('negotiates a supported protocol version on initialize', async () => {
    const reply = await handleMcpMessage(
      rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} }),
      neverCalled,
    )
    expect(reply).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'purple' },
      },
    })
  })

  it('tells the agent how a Purple set works on initialize', async () => {
    const reply = await handleMcpMessage(rpc('initialize'), neverCalled)
    // SAFETY: initialize answers with a result envelope carrying the
    // instructions string; a missing one fails the assertions below.
    const { instructions } = (reply as { result: { instructions: string } })
      .result
    expect(instructions).toContain('get_strudel_reference')
    expect(instructions).toContain('Purple plays a set, not a pattern.')
  })

  it('falls back to the latest supported version for unknown requests', async () => {
    const reply = await handleMcpMessage(
      rpc('initialize', { protocolVersion: '2099-01-01' }),
      neverCalled,
    )
    expect(reply).toMatchObject({
      result: { protocolVersion: '2025-06-18' },
    })
  })

  it('swallows notifications', async () => {
    expect(
      await handleMcpMessage(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        neverCalled,
      ),
    ).toBeNull()
  })

  it('lists the shared tool catalog', async () => {
    const reply = await handleMcpMessage(rpc('tools/list'), neverCalled)
    expect(reply).toMatchObject({
      result: {
        tools: [
          { name: 'get_strudel_reference' },
          { name: 'get_session' },
          { name: 'set_pattern' },
          { name: 'play' },
          { name: 'stop' },
        ],
      },
    })
  })

  it('serves the Strudel reference without the relay', async () => {
    const reply = await handleMcpMessage(
      rpc('tools/call', { name: 'get_strudel_reference' }),
      neverCalled,
    )
    expect(reply).toMatchObject({
      result: { isError: false, content: [{ type: 'text' }] },
    })
  })

  it('relays a tool call and formats the studio answer', async () => {
    const callAgent = vi.fn<AgentCaller>().mockResolvedValue({
      ok: true,
      result: { committed: true },
    })
    const reply = await handleMcpMessage(
      rpc('tools/call', {
        name: 'set_pattern',
        arguments: { code: 's("bd*4")' },
      }),
      callAgent,
    )
    expect(callAgent).toHaveBeenCalledWith(
      { method: 'set_pattern', code: 's("bd*4")', title: null },
      30_000,
    )
    expect(reply).toMatchObject({
      result: {
        isError: false,
        content: [{ type: 'text', text: expect.stringContaining('play to hear') }],
      },
    })
  })

  it('returns relay failures as tool errors', async () => {
    const reply = await handleMcpMessage(
      rpc('tools/call', { name: 'play' }),
      async () => ({ ok: false, error: 'No Purple tab is connected.' }),
    )
    expect(reply).toMatchObject({
      result: {
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('No Purple tab') }],
      },
    })
  })

  it('returns bad tool arguments as tool errors', async () => {
    const reply = await handleMcpMessage(
      rpc('tools/call', { name: 'set_pattern', arguments: {} }),
      neverCalled,
    )
    expect(reply).toMatchObject({
      result: {
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('code string') }],
      },
    })
  })

  it('rejects unknown tools and methods at the protocol level', async () => {
    expect(
      await handleMcpMessage(
        rpc('tools/call', { name: 'make_coffee' }),
        neverCalled,
      ),
    ).toMatchObject({ error: { code: -32602 } })
    expect(await handleMcpMessage(rpc('resources/list'), neverCalled)).toMatchObject(
      { error: { code: -32601 } },
    )
    expect(await handleMcpMessage('not an object', neverCalled)).toMatchObject({
      error: { code: -32600 },
    })
  })
})
