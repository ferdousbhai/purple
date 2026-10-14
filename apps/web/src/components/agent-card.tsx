/**
 * The pairing panel: Purple's first-run surface. It hands the visitor the one
 * address their agent needs, in whatever form their client expects.
 */
import { AGENT_CLIENTS } from '@purple/core/agent-tools'
import { useClipboardCopy } from '@purple/ui/use-clipboard-copy'
import { useState } from 'react'
import { agentMcpUrl } from '#/lib/agent-link-storage'

const AGENT_PROMPT = 'Read https://soundspurple.com/connect/guide, connect to my open Purple tab, and make music with me.'

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
  mobile: boolean
  onClose: () => void
}) {
  const [clientId, setClientId] = useState<AgentClientId>('claude')
  const clipboard = useClipboardCopy()
  const promptClipboard = useClipboardCopy()
  const client =
    AGENT_CLIENTS.find(({ id }) => id === clientId) ?? AGENT_CLIENTS[0]
  const command = props.mobile
    ? agentMcpUrl(props.code)
    : client.command(agentMcpUrl(client.needsPairingCode ? props.code : null))
  return (
    <aside className="session-pane agent-card">
      <pre className="agent-card-ascii" aria-hidden="true">{PURPLE_WORDMARK}</pre>
      <h2>{props.mobile ? 'CONNECT AN AGENT' : 'YOUR AGENT PLAYS THIS TAB'}</h2>
      <p role="status" className={props.linked ? 'agent-status linked' : 'agent-status'}>
        {props.linked ? 'AGENT LINKED' : 'WAITING FOR YOUR AGENT'}
      </p>
      <p>{props.mobile
        ? 'On your phone, play patterns, edit music, and save to your library. Purple does not run Claude Code or Codex here.'
        : 'Paste this into your current conversation with an agent, such as Codex or Claude Code:'}</p>
      {!props.mobile && <>
        <pre className="agent-command agent-prompt">{AGENT_PROMPT}</pre>
        <button
          type="button"
          className="primary"
          onClick={() => void promptClipboard.copy(AGENT_PROMPT)}
        >
          <span aria-live="polite">{promptClipboard.copied ? 'PROMPT COPIED' : 'COPY PROMPT'}</span>
        </button>
        <p>Your agent follows the guide to connect. Approve the connection if asked, then keep this tab open to hear the music.</p>
      </>}
      {props.mobile && (
        <p>Run your agent on another device, such as a laptop, and add this tab’s private pairing address to any MCP client that accepts a server URL. Keep this tab in front while it plays: a phone pauses background tabs, so an agent app on this same phone cannot reach it.</p>
      )}
      <details className="agent-setup" open={props.mobile}>
        <summary>{props.mobile ? 'PAIRING ADDRESS' : 'MANUAL MCP SETUP'}</summary>
        {!props.mobile && <p>Or register Purple with your agent yourself:</p>}
        {!props.mobile && <div className="agent-clients" role="group" aria-label="Agent">
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
        </div>}
        <pre className="agent-command">{command}</pre>
        <div className="agent-card-actions">
          <button
            type="button"
            className="primary"
            // A blocked clipboard is not an error here: the command stays selectable.
            onClick={() => void clipboard.copy(command)}
          >
            <span aria-live="polite">{clipboard.copied ? 'COPIED' : props.mobile ? 'COPY PAIRING ADDRESS' : 'COPY COMMAND'}</span>
          </button>
        </div>
        {!props.mobile && <p>
          {client.needsPairingCode
            ? 'This is this browser\u2019s private pairing address for any Streamable HTTP MCP client.'
            : 'It opens this browser once to ask for approval. Then ask it for music; this tab plays it.'}
        </p>}
      </details>
      <p>If sound is blocked, press PLAY once.</p>
      <button type="button" className="chrome" onClick={props.onClose}>
        CLOSE
      </button>
    </aside>
  )
}
