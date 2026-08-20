import { describe, expect, it } from 'vitest'
import { parseChatEnvelope, toChatEnvelope, type ByokChatState } from './byok'

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
