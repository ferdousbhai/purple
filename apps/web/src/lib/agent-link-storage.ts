/**
 * Agent mode is the visitor's alternative to a Gemini key: their own agent
 * drives the studio through the purple-mcp bridge. The choice (and the
 * bridge port) lives only in this browser, like everything else personal.
 */

import { AGENT_LINK_DEFAULT_PORT } from '@purple/core/agent-link'
import { isJsonNumber, parseJsonMembers } from '@purple/core/json'

const STORAGE_KEY = 'purple-agent-link'

export interface AgentLinkSettings {
  enabled: boolean
  port: number
}

export const DEFAULT_AGENT_LINK_SETTINGS: AgentLinkSettings = {
  enabled: false,
  port: AGENT_LINK_DEFAULT_PORT,
}

export function parseAgentLinkSettings(raw: string): AgentLinkSettings | null {
  const fields = parseJsonMembers(raw)
  if (!fields) return null
  const port = fields.get('port')
  return {
    enabled: fields.get('enabled') === true,
    port: isJsonNumber(port) && isValidPort(port)
      ? port
      : AGENT_LINK_DEFAULT_PORT,
  }
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

export function loadAgentLinkSettings(): AgentLinkSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const settings = parseAgentLinkSettings(raw)
      if (settings) return settings
    }
  } catch {
    // Blocked storage means agent mode simply starts switched off.
  }
  return DEFAULT_AGENT_LINK_SETTINGS
}

export function saveAgentLinkSettings(settings: AgentLinkSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // The choice still applies for this page's lifetime.
  }
}
