/**
 * The Allow page pairs an agent with this browser's studio tab, then leaves
 * for the client's callback; if no studio tab is open the agent reaches
 * nothing. Studio tabs answer a same-origin ping so the Allow page can tell,
 * and open the studio itself when none answers. A frozen background tab runs
 * no script, so it stays silent and gets replaced by a fresh one.
 */

const CHANNEL_NAME = 'purple-studio-presence'
const PING = 'ping'
const HERE = 'here'

/** Run in a studio tab: announce it, and answer every later ping. */
export function answerStudioPings(): () => void {
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event) => {
    if (event.data === PING) channel.postMessage(HERE)
  }
  channel.postMessage(HERE)
  return () => channel.close()
}

export interface StudioWatch {
  /** Whether a studio tab in this browser has answered so far. */
  readonly found: boolean
  close(): void
}

/** Run on the Allow page: ask open studio tabs to answer. */
export function watchForStudio(): StudioWatch {
  const channel = new BroadcastChannel(CHANNEL_NAME)
  const watch = { found: false, close: () => channel.close() }
  channel.onmessage = (event) => {
    if (event.data === HERE) watch.found = true
  }
  channel.postMessage(PING)
  return watch
}
