import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { encodeAgentHello, encodeAgentRequest } from '@purple/core/agent-link'
import { useAgentLink, type AgentLinkHandlers } from '@purple/ui/use-agent-link'

/** A relay socket the test drives by hand. */
class FakeSocket {
  static instances: FakeSocket[] = []
  readyState: number = WebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  send(text: string) {
    this.sent.push(text)
  }

  close() {
    this.readyState = WebSocket.CLOSED
  }

  open() {
    this.readyState = WebSocket.OPEN
    this.onopen?.()
  }

  receive(text: string) {
    this.onmessage?.({ data: text })
  }

  drop() {
    this.readyState = WebSocket.CLOSED
    this.onclose?.({ code: 1006 })
  }
}

const handlers: AgentLinkHandlers = {
  getSession: () => ({
    code: 's("bd*4")',
    title: 'Four Floor',
    playbackState: 'stopped',
    playbackError: null,
  }),
  setPattern: async () => ({ committed: true }),
  play: async () => ({ ok: true }),
  stop: () => {},
}

beforeEach(() => {
  FakeSocket.instances.length = 0
  vi.stubGlobal(
    'WebSocket',
    Object.assign(FakeSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('useAgentLink', () => {
  it('reports a link only once an agent sends a request, until the relay drops', async () => {
    const hook = renderHook(() => useAgentLink({ url: 'wss://relay.test/link/abc', handlers }))
    const [socket] = FakeSocket.instances

    act(() => socket.open())
    expect(socket.sent).toEqual([encodeAgentHello()])
    expect(hook.result.current).toBe(false)

    act(() => socket.receive(encodeAgentHello()))
    act(() => socket.receive('not json'))
    expect(hook.result.current).toBe(false)
    expect(socket.sent).toHaveLength(1)

    await act(async () => socket.receive(encodeAgentRequest({ id: '1', method: 'get_session' })))
    expect(hook.result.current).toBe(true)
    expect(socket.sent).toHaveLength(2)

    act(() => socket.drop())
    expect(hook.result.current).toBe(false)
    hook.unmount()
  })
})
