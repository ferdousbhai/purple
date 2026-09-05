/**
 * The visitor's own agent drives the studio through the hosted MCP relay. The
 * pairing code lives only in this browser and doubles as the capability that
 * lets an agent reach this tab, so it is minted from crypto randomness and
 * kept stable: an endpoint registered once keeps working across visits.
 */

import { AGENT_LINK_DEFAULT_PORT } from '@purple/core/agent-link'
import { agentEndpoint } from '@purple/core/agent-tools'
import { jsonText, parseJsonMembers } from '@purple/core/json'

const STORAGE_KEY = 'purple-agent-link'
const CODE_PATTERN = /^[A-Za-z0-9_-]{12,64}$/

export interface AgentLinkSettings {
  code: string
  /** Hand-set escape hatch: pair with the offline purple-mcp bridge on
   * 127.0.0.1 instead of the hosted relay. No UI toggles this. */
  local: boolean
}

export function generateAgentLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function parseAgentLinkSettings(raw: string): AgentLinkSettings | null {
  const fields = parseJsonMembers(raw)
  if (!fields) return null
  const code = jsonText(fields.get('code'))
  if (code === null || !CODE_PATTERN.test(code)) return null
  return { code, local: fields.get('local') === true }
}

export function loadAgentLinkSettings(): AgentLinkSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const settings = parseAgentLinkSettings(raw)
      if (settings) return settings
    }
  } catch {
    // Blocked storage means this visit pairs under a fresh code.
  }
  // First visit (or a pre-relay stored shape): mint a code and keep it, so
  // the MCP endpoint the visitor registers stays stable across sessions.
  const settings = { code: generateAgentLinkCode(), local: false }
  saveAgentLinkSettings(settings)
  return settings
}

export function saveAgentLinkSettings(settings: AgentLinkSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // The choice still applies for this page's lifetime.
  }
}

export function agentLinkSocketUrl(settings: AgentLinkSettings): string {
  if (settings.local) return `ws://127.0.0.1:${AGENT_LINK_DEFAULT_PORT}`
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${window.location.host}/link/${settings.code}`
}

/** The endpoint to register: bare for clients that authorize in the browser. */
export function agentMcpUrl(pairingCode: string | null): string {
  return agentEndpoint(window.location.origin, pairingCode)
}
