import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createByokBackend,
  parseChatEnvelope,
  toChatEnvelope,
  type ByokChatState,
} from './byok'

afterEach(() => {
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

  it('never lets the cap push coveredCount below zero', () => {
    const messages = Array.from({ length: 250 }, () => ({
      role: 'user' as const,
      content: 'x',
    }))
    const envelope = toChatEnvelope(chat({ messages, coveredCount: 10 }))
    expect(envelope.coveredCount).toBe(0)
  })

  it('clamps an out-of-range live coveredCount when storing', () => {
    expect(toChatEnvelope(chat({ coveredCount: 99 })).coveredCount).toBe(2)
    expect(toChatEnvelope(chat({ coveredCount: -3 })).coveredCount).toBe(0)
  })
})

describe('BYOK streaming backend', () => {
  it('implements the shared stream outcome and reports truncation', async () => {
    const body = [
      'data: {"candidates":[{"content":{"parts":[{"text":"s(\\"bd*4\\")"}]}}],"usageMetadata":{"promptTokenCount":42}}',
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
})
