/**
 * The pairing panel: Purple's first-run surface. It hands the visitor the one
 * address their agent needs, in whatever form their client expects.
 */
import { useState } from 'react'
import { agentMcpUrl } from '#/lib/agent-link-storage'

// Block wordmark. Rows are fixed width so the letterforms stay aligned in any
// monospace fallback.
const PURPLE_WORDMARK = [
  '███  █  █ ███  ███  █    ████',
  '█  █ █  █ █  █ █  █ █    █',
  '███  █  █ ███  ███  █    ███',
  '█    █  █ █ █  █    █    █',
  '█     ██  █  █ █    ████ ████',
].join('\n')

/** Every client speaks the same Streamable HTTP MCP endpoint; only the way
 * they are told about it differs, so the raw URL is always an option. */
const AGENT_CLIENTS = [
  {
    id: 'claude',
    label: 'CLAUDE CODE',
    command: (url: string) => `claude mcp add --transport http purple ${url}`,
  },
  {
    id: 'codex',
    label: 'CODEX',
    command: (url: string) => `codex mcp add purple --url ${url}`,
  },
  {
    id: 'other',
    label: 'OTHER',
    command: (url: string) => url,
  },
] as const

type AgentClientId = (typeof AGENT_CLIENTS)[number]['id']

export function AgentCard(props: { code: string; linked: boolean }) {
  const [clientId, setClientId] = useState<AgentClientId>('claude')
  const [copied, setCopied] = useState(false)
  const url = agentMcpUrl(props.code)
  const client =
    AGENT_CLIENTS.find(({ id }) => id === clientId) ?? AGENT_CLIENTS[0]
  const command = client.command(url)
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Clipboard blocked; the command stays selectable text.
    }
  }
  return (
    <aside className="session-pane agent-card">
      <pre className="agent-card-ascii" aria-hidden="true">{PURPLE_WORDMARK}</pre>
      <h2>YOUR AGENT PLAYS THIS TAB</h2>
      <p role="status" className={props.linked ? 'agent-status linked' : 'agent-status'}>
        {props.linked ? 'AGENT LINKED' : 'WAITING FOR YOUR AGENT'}
      </p>
      <p>Register this tab with your agent, once:</p>
      <div className="agent-clients" role="group" aria-label="Agent">
        {AGENT_CLIENTS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`chip ${option.id === clientId ? 'selected' : ''}`}
            aria-pressed={option.id === clientId}
            onClick={() => {
              setClientId(option.id)
              setCopied(false)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <pre className="agent-command">{command}</pre>
      <div className="agent-card-actions">
        <button type="button" className="primary" onClick={copyCommand}>
          <span aria-live="polite">{copied ? 'COPIED' : 'COPY'}</span>
        </button>
      </div>
      <p>
        {clientId === 'other'
          ? 'Any MCP client that speaks Streamable HTTP can use this endpoint.'
          : 'Then ask it for music. It writes the patterns; this tab plays them.'}
      </p>
      <p>
        The link is this tab&rsquo;s private pairing address. If sound is
        blocked, press PLAY once.
      </p>
    </aside>
  )
}
