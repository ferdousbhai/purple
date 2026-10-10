import { describe, expect, it } from 'vitest'
import { agentLinkCodeFromPath, mcpEndpointHelp } from './agent-relay'

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

describe('mcpEndpointHelp', () => {
  it('answers a path without a pairing code with plain-text 404 help', async () => {
    const response = mcpEndpointHelp(new Request('https://soundspurple.com/mcp'), null)
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toContain('text/plain')
    const text = await response.text()
    expect(text).toContain('Allow')
    expect(text).toContain('claude mcp add --transport http purple https://soundspurple.com/mcp\n')
    expect(text).toContain('https://soundspurple.com/llms.txt')
  })

  it('answers a GET on a real endpoint with 405 and an Allow header', async () => {
    const request = new Request('https://soundspurple.com/mcp/0f7c2d91aa34bb56cc78')
    const response = mcpEndpointHelp(request, '0f7c2d91aa34bb56cc78')
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(await response.text()).toContain('Allow')
  })
})
