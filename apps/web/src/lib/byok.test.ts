import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createByokBackend,
  clearByokChat,
  loadByokChat,
  saveByokChat,
  type ByokChatState,
} from './byok'
import { localStorageStub } from '@purple/ui/testing'

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

function streamingResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function waitForAbort(_url: string, init: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

async function streamBody(body: string): Promise<{
  deltas: string[]
  promptTokens: number | null
  truncated: boolean
}> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingResponse(body)))
  const deltas: string[] = []
  const result = await createByokBackend('secret-key').stream(
    [{ role: 'user', content: 'drums' }],
    (delta) => deltas.push(delta),
  )
  return { deltas, ...result }
}

describe('byok chat adapter', () => {
  it('stores the transcript under the BYOK key while a key is present', () => {
    const { values, window } = localStorageStub([['purple.byok.gemini-key', 'k']])
    vi.stubGlobal('window', window)

    expect(saveByokChat(chat())).toBe(true)
    expect(values.has('purple.byok.chat')).toBe(true)
    expect(loadByokChat()).toEqual(chat())
    expect(clearByokChat()).toBe(true)
    expect(values.has('purple.byok.chat')).toBe(false)
  })

  it('purges an orphaned transcript when the key was removed out-of-band', () => {
    const { values, window } = localStorageStub()
    vi.stubGlobal('window', window)
    saveByokChat(chat())

    expect(loadByokChat()).toBeNull()
    expect(values.has('purple.byok.chat')).toBe(false)
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
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse(body))
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
    await expect(streamBody(body)).resolves.toEqual({
      deltas: ['drum', '✨'],
      promptTokens: 7,
      truncated: false,
    })
  })

  it('ignores malformed SSE payloads and continues with the next event', async () => {
    const body = [
      'data: {"candidates":[{"content":{"parts":[{"text":7}]}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":"s(\\"bd\\")"}]}}]}',
      '',
    ].join('\n')
    await expect(streamBody(body)).resolves.toEqual({
      deltas: ['s("bd")'],
      promptTokens: null,
      truncated: false,
    })
  })

  it('rejects a schema-invalid one-shot response as empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ candidates: 'not-an-array' })),
    )

    await expect(
      createByokBackend('secret-key').repairPattern('fix it'),
    ).rejects.toThrow('Gemini returned an empty response.')
  })

  it('aborts the active stream through the shared backend contract', async () => {
    const fetchMock = vi.fn().mockImplementation(waitForAbort)
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
      vi.fn().mockImplementation(waitForAbort),
    )

    const pending = createByokBackend('secret-key').repairPattern('fix it')
    const rejection = expect(pending).rejects.toThrow(
      'Gemini took too long to respond. Please try again.',
    )
    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
  })
})
