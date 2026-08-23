import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createByokBackend,
  clearByokChat,
  parseChatEnvelope,
  saveByokChat,
  toChatEnvelope,
  type ByokChatState,
} from './byok'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function chat(overrides: Partial<ByokChatState> = {}): ByokChatState {
  return {
    messages: [
      { role: 'user', content: 'four on the floor' },
      { role: 'assistant', content: '```strudel\ns("bd*4")\n```' },
    ],
    artifact: { summary: 'A techno session.', latestPattern: 's("bd*4")' },
    coveredCount: 2,
    ...overrides,
  }
}

describe('byok chat persistence envelope', () => {
  it('round-trips a chat through the stored envelope', () => {
    const state = chat()
    expect(parseChatEnvelope(JSON.stringify(toChatEnvelope(state)))).toEqual(state)
  })

  it('round-trips the pre-first-fold shape (no artifact)', () => {
    const state = chat({ artifact: null, coveredCount: 0 })
    expect(parseChatEnvelope(JSON.stringify(toChatEnvelope(state)))).toEqual(state)
  })

  it('discards malformed JSON silently', () => {
    expect(parseChatEnvelope('{not json')).toBeNull()
  })

  it('discards an envelope from another version', () => {
    const raw = JSON.stringify({ ...toChatEnvelope(chat()), v: 3 })
    expect(parseChatEnvelope(raw)).toBeNull()
  })

  it('migrates a v1 envelope, mapping text onto content', () => {
    const raw = JSON.stringify({
      v: 1,
      messages: [
        { role: 'user', text: 'four on the floor' },
        { role: 'assistant', text: 's("bd*4")' },
      ],
      artifact: { summary: 'A techno session.', latestPattern: 's("bd*4")' },
      coveredCount: 5,
    })
    expect(parseChatEnvelope(raw)).toEqual({
      messages: [
        { role: 'user', content: 'four on the floor' },
        { role: 'assistant', content: 's("bd*4")' },
      ],
      artifact: { summary: 'A techno session.', latestPattern: 's("bd*4")' },
      coveredCount: 2,
    })
  })

  it('discards an envelope whose fields do not match the schema', () => {
    expect(parseChatEnvelope(JSON.stringify({ v: 2, messages: 'nope' }))).toBeNull()
    expect(
      parseChatEnvelope(
        JSON.stringify({
          v: 1,
          messages: [{ role: 'system', content: 'x' }],
          artifact: null,
          coveredCount: 0,
        }),
      ),
    ).toBeNull()
    expect(
      parseChatEnvelope(
        JSON.stringify({ v: 2, messages: [], artifact: null, coveredCount: -1 }),
      ),
    ).toBeNull()
  })

  it('clamps a stored coveredCount that exceeds the stored messages', () => {
    const raw = JSON.stringify({
      v: 2,
      messages: [{ role: 'user', content: 'hi' }],
      artifact: { summary: 's', latestPattern: '' },
      coveredCount: 5,
    })
    expect(parseChatEnvelope(raw)?.coveredCount).toBe(1)
  })

  it('caps the stored transcript and shifts coveredCount by the dropped prefix', () => {
    const messages = Array.from({ length: 250 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message ${index}`,
    }))
    const envelope = toChatEnvelope(chat({ messages, coveredCount: 240 }))
    expect(envelope.messages).toHaveLength(200)
    expect(envelope.messages[0]?.content).toBe('message 50')
    // 50 covered messages fell off the front; the artifact still summarizes them.
    expect(envelope.coveredCount).toBe(190)
  })

  it('retains uncovered messages even when they exceed the persistence target', () => {
    const messages = Array.from({ length: 250 }, () => ({
      role: 'user' as const,
      content: 'x',
    }))
    const envelope = toChatEnvelope(chat({ messages, coveredCount: 10 }))
    expect(envelope.messages).toHaveLength(240)
    expect(envelope.messages[0]?.content).toBe('x')
    expect(envelope.coveredCount).toBe(0)
  })

  it('does not drop messages when there is no usable artifact', () => {
    const messages = Array.from({ length: 250 }, (_, index) => ({
      role: 'user' as const,
      content: `message ${index}`,
    }))
    const envelope = toChatEnvelope(
      chat({ messages, artifact: null, coveredCount: 240 }),
    )
    expect(envelope.messages).toEqual(messages)
    expect(envelope.coveredCount).toBe(0)
  })

  it('clamps an out-of-range live coveredCount when storing', () => {
    expect(toChatEnvelope(chat({ coveredCount: 99 })).coveredCount).toBe(2)
    expect(toChatEnvelope(chat({ coveredCount: -3 })).coveredCount).toBe(0)
  })

  it('reports blocked chat writes and clears to the caller', () => {
    vi.stubGlobal('window', {
      localStorage: {
        setItem: vi.fn(() => {
          throw new DOMException('blocked', 'QuotaExceededError')
        }),
        removeItem: vi.fn(() => {
          throw new DOMException('blocked', 'SecurityError')
        }),
      },
    })

    expect(saveByokChat(chat())).toBe(false)
    expect(clearByokChat()).toBe(false)
  })

  it('confirms successful chat writes and clears', () => {
    const setItem = vi.fn()
    const removeItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { setItem, removeItem } })

    expect(saveByokChat(chat())).toBe(true)
    expect(clearByokChat()).toBe(true)
    expect(setItem).toHaveBeenCalledOnce()
    expect(removeItem).toHaveBeenCalledOnce()
  })
})

describe('BYOK streaming backend', () => {
  it('implements the shared stream outcome and reports truncation', async () => {
    const body = [
      'data: {"candidates":[{"content":{"parts":[{"text":"s(\\"bd*4\\")"}]}}],"usageMetadata":{"promptTokenCount":42}}',
      '',
      'data: {"candidates":[{"finishReason":"MAX_TOKENS"}]}',
      '',
    ].join('\n')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const backend = createByokBackend('secret-key')
    const deltas: string[] = []

    await expect(
      backend.stream(
        [{ role: 'user', content: 'four on the floor' }],
        (delta) => deltas.push(delta),
      ),
    ).resolves.toEqual({ promptTokens: 42, truncated: true })
    expect(deltas).toEqual(['s("bd*4")'])

    // SAFETY: the backend made exactly one fetch call above with a URL and init.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('secret-key')
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('secret-key')
  })

  it('joins multiline SSE data and consumes an unterminated final event', async () => {
    const body = [
      'data: {',
      'data:   "candidates": [{"content":{"parts":[{"text":"drum"}]}}],',
      'data:   "usageMetadata": {"promptTokenCount": 7}',
      'data: }',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":"✨"}]}}]}',
    ].join('\r\n')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const deltas: string[] = []

    await expect(
      createByokBackend('secret-key').stream(
        [{ role: 'user', content: 'drums' }],
        (delta) => deltas.push(delta),
      ),
    ).resolves.toEqual({ promptTokens: 7, truncated: false })
    expect(deltas).toEqual(['drum', '✨'])
  })

  it('aborts the active stream through the shared backend contract', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const backend = createByokBackend('secret-key')
    const pending = backend.stream(
      [{ role: 'user', content: 'ambient dub' }],
      () => {},
    )

    await backend.abortStream()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('bounds one-shot requests and returns a useful timeout error', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )

    const pending = createByokBackend('secret-key').repairPattern('fix it')
    const rejection = expect(pending).rejects.toThrow(
      'Gemini took too long to respond. Please try again.',
    )
    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
  })
})
