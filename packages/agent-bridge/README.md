# purple-mcp

An MCP stdio server that lets a local agent (Claude Code, or any MCP client)
play music in a Purple tab. It listens for the studio on a 127.0.0.1
WebSocket; the tab connects out when the visitor chooses LOCAL AGENT on the
session panel. Nothing leaves the computer: the bridge relays only session
state and pattern code between the agent and the tab.

## Setup

Requires Node 22.18 or newer (the bin runs the TypeScript sources directly).

From a checkout, register the bridge with Claude Code:

```sh
claude mcp add purple -- node <repo>/packages/agent-bridge/bin/purple-mcp.mjs
```

Then open Purple, choose LOCAL AGENT on the session panel, and ask the agent
to make music. `--port <n>` (or `PURPLE_MCP_PORT`) moves the WebSocket off
the default port 7723; change the port in the studio panel to match.

## Tools

- `get_strudel_reference`: the notation reference patterns must stay within
  (works before a tab connects)
- `get_session`: editor code, title, and playback state
- `set_pattern`: replace the editor pattern; the studio validates against its
  sound registry and returns problems to revise against
- `play`: play the editor pattern, crossfading if music is already playing
- `stop`: stop playback

Browsers only allow sound after a click, so the first `play` after a page
load may ask the visitor to press PLAY in the tab once.
