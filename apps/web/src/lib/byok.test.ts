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
  pattern: string
  promptTokens: number | null
}> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingResponse(body)))
  const deltas: string[] = []
  const result = await createByokBackend('secret-key').stream(
    [{ role: 'user', content: 'drums' }],
    {
      onPatternDelta: (delta) => deltas.push(delta),
      onPatternComplete: () => undefined,
    },
  )
  return { deltas, pattern: result.turn.pattern, ...result }
}

const suggestions = [
  { label: 'Drift to dub', prompt: 'Continue as spacious dub' },
  { label: 'Lift the pulse', prompt: 'Continue as bright house' },
  { label: 'Melt to ambient', prompt: 'Continue as soft ambient' },
]

function generatedTurn(pattern: string): string {
  return JSON.stringify({
    pattern,
    progression: {
      afterCycles: 1_856,
      nextAction: 'Strip back to bass and filtered drums',
    },
    title: 'Test pattern',
    suggestions,
    explanation: 'A focused groove.',
  })
}

function geminiEvent(text: string, promptTokenCount?: number): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata:
      promptTokenCount === undefined ? undefined : { promptTokenCount },
  })
}

function requiredResponseFields(fetchMock: ReturnType<typeof vi.fn>): string[] {
  // SAFETY: callers pass a fetch mock after exactly one request has completed.
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  // SAFETY: these tests own the serialized request body and its schema shape.
  const request = JSON.parse(String(init.body)) as {
    generationConfig: { responseJsonSchema: { required: string[] } }
  }
  return request.generationConfig.responseJsonSchema.required
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
  it('salvages the leading pattern when the output limit truncates metadata', async () => {
    const body = [
      `data: ${geminiEvent('{"pattern":"s(\\"bd*4\\")"', 42)}`,
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
        {
          onPatternDelta: (delta) => deltas.push(delta),
          onPatternComplete: () => undefined,
        },
      ),
    ).resolves.toEqual({
      turn: {
        pattern: 's("bd*4")',
        progression: null,
        title: null,
        suggestions: [],
        explanation: '',
      },
      promptTokens: 42,
    })
    expect(deltas).toEqual(['s("bd*4")'])

    // SAFETY: the backend made exactly one fetch call above with a URL and init.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(url).not.toContain('secret-key')
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('secret-key')
    // SAFETY: this test owns the serialized request body and checks its schema fields.
    const request = JSON.parse(String(init.body)) as {
      generationConfig: {
        responseMimeType: string
        responseJsonSchema: {
          properties: {
            pattern: unknown
            progression: unknown
            title: unknown
            suggestions: unknown
            explanation: unknown
          }
          required: string[]
        }
      }
    }
    expect(request.generationConfig.responseMimeType).toBe('application/json')
    expect(Object.keys(request.generationConfig.responseJsonSchema.properties)[0])
      .toBe('pattern')
    expect(request.generationConfig.responseJsonSchema.required[0]).toBe('pattern')
  })

  it('joins multiline SSE data and consumes an unterminated final event', async () => {
    const turn = generatedTurn('drum✨')
    const split = turn.indexOf('✨')
    const first = geminiEvent(turn.slice(0, split))
    const second = geminiEvent(turn.slice(split))
    const body = [
      `data: ${first.slice(0, 1)}`,
      `data: ${first.slice(1)}`,
      '',
      `data: ${second}`,
    ].join('\r\n')
    await expect(streamBody(body)).resolves.toEqual({
      deltas: ['drum', '✨'],
      pattern: 'drum✨',
      promptTokens: null,
      turn: {
        pattern: 'drum✨',
        progression: {
          afterCycles: 1_856,
          nextAction: 'Strip back to bass and filtered drums',
        },
        title: 'Test pattern',
        suggestions,
        explanation: 'A focused groove.',
      },
    })
  })

  it('ignores malformed SSE payloads and continues with the next event', async () => {
    const body = [
      'data: {"candidates":[{"content":{"parts":[{"text":7}]}}]}',
      '',
      `data: ${geminiEvent(generatedTurn('s("bd")'))}`,
      '',
    ].join('\n')
    await expect(streamBody(body)).resolves.toEqual({
      deltas: ['s("bd")'],
      pattern: 's("bd")',
      promptTokens: null,
      turn: {
        pattern: 's("bd")',
        progression: {
          afterCycles: 1_856,
          nextAction: 'Strip back to bass and filtered drums',
        },
        title: 'Test pattern',
        suggestions,
        explanation: 'A focused groove.',
      },
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
      {
        onPatternDelta: () => undefined,
        onPatternComplete: () => undefined,
      },
    )

    await backend.abortStream()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts an active pattern repair independently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(waitForAbort))
    const backend = createByokBackend('secret-key')
    const pending = backend.repairPattern('fix it')

    backend.abortRepair()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts active background compaction independently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(waitForAbort))
    const backend = createByokBackend('secret-key')
    const pending = backend.generateCompactionSummary(null, [
      { role: 'user', content: 'summarize this session' },
    ])

    backend.abortCompaction()

    await expect(pending).resolves.toMatchObject({ ok: false })
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

  it('parses a structured repair without requesting turn metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: '{"pattern":"s(\\"hh*8\\")"}' }] } }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createByokBackend('secret-key').repairPattern('fix it'),
    ).resolves.toBe('s("hh*8")')

    expect(requiredResponseFields(fetchMock)).toEqual(['pattern'])
  })

  it('binds the remaining compaction call directly to structured generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                summary: 'A focused house session.',
                latestPattern: 's("bd*4")',
              }),
            }],
          },
        }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createByokBackend('secret-key').generateCompactionSummary(null, [
        { role: 'user', content: 'Make house music' },
      ]),
    ).resolves.toEqual({
      ok: true,
      artifact: {
        summary: 'A focused house session.',
        latestPattern: 's("bd*4")',
      },
    })

    expect(requiredResponseFields(fetchMock)).toEqual([
      'summary',
      'latestPattern',
    ])
  })
})
