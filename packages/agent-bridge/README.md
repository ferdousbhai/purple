# purple-mcp

An MCP stdio server that lets a local agent (Claude Code, or any MCP client)
play music in a Purple tab entirely over 127.0.0.1.

Most people do not need it: the website hosts an MCP relay, and the LOCAL
AGENT panel in the studio shows a `claude mcp add --transport http` command
with the tab's private pairing address. This bridge is the fully offline
alternative for development or for keeping even pattern code off the wire.

## Setup

Requires Node 22.18 or newer (the bin runs the TypeScript sources directly).

From a checkout, register the bridge with Claude Code:

```sh
claude mcp add purple -- node <repo>/packages/agent-bridge/bin/purple-mcp.mjs
```

Then open Purple, choose LOCAL AGENT, and point the tab at the bridge by
setting `"local": true` inside the `purple-agent-link` localStorage entry
(no UI toggles this). Ask the agent to make music. `--port <n>` (or
`PURPLE_MCP_PORT`) moves the WebSocket off the default port 7723, though the
tab always dials 7723 in local mode.

## Tools

The tool surface is shared with the hosted relay via `@purple/core/agent-tools`:

- `get_strudel_reference`: the notation reference patterns must stay within
  (works before a tab connects)
- `get_session`: editor code, title, and playback state
- `set_pattern`: replace the editor pattern; the studio validates against its
  sound registry and returns problems to revise against
- `play`: play the editor pattern, crossfading if music is already playing
- `stop`: stop playback

Browsers only allow sound after a click, so the first `play` after a page
load may ask the visitor to press PLAY in the tab once.
