/**
 * The pairing panel: Purple's first-run surface. It hands the visitor the one
 * address their agent needs, in whatever form their client expects.
 */
import { AGENT_CLIENTS } from '@purple/core/agent-tools'
import { useClipboardCopy } from '@purple/ui/use-clipboard-copy'
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

type AgentClientId = (typeof AGENT_CLIENTS)[number]['id']

export function AgentCard(props: {
  code: string
  linked: boolean
  onClose: () => void
}) {
  const [clientId, setClientId] = useState<AgentClientId>('claude')
  const clipboard = useClipboardCopy()
  const client =
    AGENT_CLIENTS.find(({ id }) => id === clientId) ?? AGENT_CLIENTS[0]
  const command = client.command(
    agentMcpUrl(client.needsPairingCode ? props.code : null),
  )
  return (
    <aside className="session-pane agent-card">
      <pre className="agent-card-ascii" aria-hidden="true">{PURPLE_WORDMARK}</pre>
      <h2>YOUR AGENT PLAYS THIS TAB</h2>
      <p role="status" className={props.linked ? 'agent-status linked' : 'agent-status'}>
        {props.linked ? 'AGENT LINKED' : 'WAITING FOR YOUR AGENT'}
      </p>
      <p>Register Purple with your agent, once:</p>
      <div className="agent-clients" role="group" aria-label="Agent">
        {AGENT_CLIENTS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`chip ${option.id === clientId ? 'selected' : ''}`}
            aria-pressed={option.id === clientId}
            onClick={() => {
              setClientId(option.id)
              clipboard.reset()
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <pre className="agent-command">{command}</pre>
      <div className="agent-card-actions">
        <button
          type="button"
          className="primary"
          // A blocked clipboard is not an error here: the command stays selectable.
          onClick={() => void clipboard.copy(command)}
        >
          <span aria-live="polite">{clipboard.copied ? 'COPIED' : 'COPY'}</span>
        </button>
        <button type="button" className="chrome" onClick={props.onClose}>
          CLOSE
        </button>
      </div>
      <p>
        {client.needsPairingCode
          ? 'This is this browser\u2019s private pairing address for any Streamable HTTP MCP client.'
          : 'It opens this browser once to ask for approval. Then ask it for music; this tab plays it.'}
      </p>
      <p>If sound is blocked, press PLAY once.</p>
    </aside>
  )
}
