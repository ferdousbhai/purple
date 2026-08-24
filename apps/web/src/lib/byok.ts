/**
 * Bring-your-own-key mode: the visitor's Gemini API key lives only in this
 * browser's localStorage and every request goes straight from the browser to
 * Google's API. Purple's servers are never in the path - the key is sent in a
 * request header (never a URL) and is never transmitted to, logged by, or
 * recoverable from Purple.
 */

import {
  DEFAULT_GEMINI_MODEL,
  SYSTEM_PROMPT,
  createModelHelpers,
  type CompactionSummarizer,
  type ResponseSchema,
} from '@purple/core'
import type {
  ChatMessage,
  PatternStreamer,
  TitleGenerator,
  TransitionSuggester,
} from '@purple/core/types'
import {
  isJsonNumber,
  isJsonString,
  jsonMembers,
  type JsonValue,
} from '@purple/core/json'
import { createChatStore } from '@purple/ui/session-store'
import type { StudioChatState } from '@purple/ui/use-studio-chat'
import { CHAT_STORAGE_KEY, getByokKey } from './byok-storage'

export { clearByokChat, getByokKey, setByokKey } from './byok-storage'
const ONE_SHOT_TIMEOUT_MS = 45_000
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
const STREAM_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:streamGenerateContent`

/** The BYOK chat a browser carries across reloads. */
export type ByokChatState = StudioChatState

/** The generation knobs this client sets on Gemini's generateContent call. */
interface GeminiGenerationConfig {
  responseMimeType?: string
  responseJsonSchema?: ResponseSchema
  thinkingConfig?: { thinkingLevel: 'low' | 'medium' | 'high' }
}

interface GeminiRequestBody {
  systemInstruction: { parts: Array<{ text: string }> }
  contents: Array<{ role: 'model' | 'user'; parts: Array<{ text: string }> }>
  generationConfig?: GeminiGenerationConfig
}

/**
 * Gemini's wire shapes, decoded at the fetch boundary. Anything Gemini sends
 * that does not match - an HTML error page, a truncated body - decodes to the
 * empty object, which the callers below already handle as "no usable text".
 */
interface GeminiContent {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  usageMetadata?: { promptTokenCount?: number }
}

/** Envelope handling, trimming and validation live in the shared store. */
const chatStore = createChatStore(CHAT_STORAGE_KEY)

export function loadByokChat(): ByokChatState | null {
  // A transcript with no key alongside it is an orphan - the key was removed
  // out-of-band (another tab, devtools), and without a key the composer that
  // could clear it never renders. Purge instead of loading.
  if (getByokKey() === null) {
    chatStore.clear()
    return null
  }
  return chatStore.load()
}

export const saveByokChat = chatStore.save

/**
 * The web app's backend: the shared capability interfaces it implements,
 * plus the repair round-trip the shared repair loop plugs into.
 */
interface ByokBackend
  extends TitleGenerator,
    TransitionSuggester,
    CompactionSummarizer,
    PatternStreamer {
  /** Send a prepared repair message; resolves with the raw model text. */
  repairPattern(message: string): Promise<string>
}

/** Bind the visitor's key into a backend the studio UI talks to. */
export function createByokBackend(key: string): ByokBackend {
  let activeStream: AbortController | null = null

  return {
    // Titles, transition suggestions, and compaction summaries share the
    // structured-generation wrappers in @purple/core; only the transport -
    // one JSON-mode generateContent call - is supplied here.
    ...createModelHelpers((systemInstruction, input, schema) =>
      callGemini(key, systemInstruction, [{ role: 'user', content: input }], {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      }),
    ),

    async stream(messages, onDelta) {
      activeStream?.abort()
      const controller = new AbortController()
      activeStream = controller
      try {
        const { promptTokens, truncated } = await streamGemini(
          key,
          SYSTEM_PROMPT,
          messages,
          onDelta,
          controller.signal,
        )
        return { promptTokens, truncated }
      } finally {
        if (activeStream === controller) activeStream = null
      }
    },

    async abortStream() {
      activeStream?.abort()
      activeStream = null
    },

    repairPattern: (message) =>
      callGemini(key, SYSTEM_PROMPT, [{ role: 'user', content: message }]),
  }
}

function buildRequestBody(
  system: string,
  messages: readonly ChatMessage[],
  generationConfig?: GeminiGenerationConfig,
): GeminiRequestBody {
  const body: GeminiRequestBody = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    generationConfig,
  }
  // Low thinking keeps generation latency down. Thinking levels are a Gemini 3
  // feature.
  if (DEFAULT_GEMINI_MODEL.startsWith('gemini-3')) {
    body.generationConfig = {
      thinkingConfig: { thinkingLevel: 'low' },
      ...generationConfig,
    }
  }
  return body
}

async function throwRequestError(response: Response): Promise<never> {
  let detail = `Gemini request failed (${response.status}).`
  try {
    const message = geminiErrorMessage(await response.json())
    if (message) detail = message
  } catch {
    // Keep the status-based message.
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    detail += ' Check that your Gemini API key is valid.'
  }
  throw new Error(detail)
}

function chunkText(data: GeminiContent): string {
  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
}

async function callGemini(
  key: string,
  system: string,
  messages: readonly ChatMessage[],
  generationConfig?: GeminiGenerationConfig,
): Promise<string> {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, ONE_SHOT_TIMEOUT_MS)

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(buildRequestBody(system, messages, generationConfig)),
      signal: controller.signal,
    })
    if (!response.ok) await throwRequestError(response)
    const text = chunkText(parseGeminiContent(await response.json()))
    if (!text) throw new Error('Gemini returned an empty response.')
    return text
  } catch (error) {
    if (timedOut) {
      throw new Error('Gemini took too long to respond. Please try again.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

interface StreamedGeneration {
  /** Gemini's reported prompt token count, or null when absent. Feeds the
   * compaction trigger with exact sizes instead of estimates. */
  promptTokens: number | null
  truncated: boolean
}

/**
 * Stream a generation over SSE, delivering text deltas as they arrive and
 * resolving with the full response text. Data lines are joined until the
 * event's blank-line delimiter, as required by the SSE framing protocol.
 */
async function streamGemini(
  key: string,
  system: string,
  messages: readonly ChatMessage[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<StreamedGeneration> {
  const response = await fetch(`${STREAM_ENDPOINT}?alt=sse`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify(buildRequestBody(system, messages)),
    signal,
  })
  if (!response.ok) await throwRequestError(response)
  if (!response.body) throw new Error('Gemini returned an empty response.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let total = ''
  let promptTokens: number | null = null
  let truncated = false
  let eventData: string[] = []
  const consumeEvent = () => {
    if (eventData.length === 0) return
    let event: GeminiContent
    try {
      event = parseGeminiContent(JSON.parse(eventData.join('\n')))
    } catch {
      eventData = []
      return
    }
    eventData = []
    promptTokens = event.usageMetadata?.promptTokenCount ?? promptTokens
    truncated =
      event.candidates?.[0]?.finishReason === 'MAX_TOKENS' || truncated
    const text = chunkText(event)
    if (!text) return
    total += text
    onDelta(text)
  }
  const consumeLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') {
      consumeEvent()
      return
    }
    if (!line.startsWith('data:')) return
    const value = line.slice('data:'.length)
    eventData.push(value.startsWith(' ') ? value.slice(1) : value)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split('\n')
    // The last element may be a partial line; keep it buffered.
    buffered = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
  }
  buffered += decoder.decode()
  if (buffered) consumeLine(buffered)
  consumeEvent()
  if (!total) throw new Error('Gemini returned an empty response.')
  return { promptTokens, truncated }
}

function geminiErrorMessage(value: JsonValue): string | null {
  const errorValue = jsonMembers(value)?.get('error')
  const message = errorValue === undefined
    ? undefined
    : jsonMembers(errorValue)?.get('message')
  return isJsonString(message) ? message : null
}

function parseGeminiContent(value: JsonValue): GeminiContent {
  const fields = jsonMembers(value)
  if (!fields) return {}
  const candidates = parseCandidates(fields.get('candidates'))
  if (candidates === null) return {}
  const usageMetadata = parseUsageMetadata(fields.get('usageMetadata'))
  if (usageMetadata === null) return {}
  const parsed: GeminiContent = {}
  if (candidates !== undefined) parsed.candidates = candidates
  if (usageMetadata !== undefined) parsed.usageMetadata = usageMetadata
  return parsed
}

function parseCandidates(
  value: JsonValue | undefined,
): GeminiContent['candidates'] | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const candidates: NonNullable<GeminiContent['candidates']> = []
  for (const candidate of value) {
    const fields = jsonMembers(candidate)
    if (!fields) return null
    const finishReason = fields.get('finishReason')
    if (finishReason !== undefined && !isJsonString(finishReason)) {
      return null
    }
    const content = parseContent(fields.get('content'))
    if (content === null) return null
    const parsed: NonNullable<GeminiContent['candidates']>[number] = {}
    if (content !== undefined) parsed.content = content
    if (isJsonString(finishReason)) parsed.finishReason = finishReason
    candidates.push(parsed)
  }
  return candidates
}

function parseContent(
  value: JsonValue | undefined,
): NonNullable<NonNullable<GeminiContent['candidates']>[number]['content']> | null | undefined {
  if (value === undefined) return undefined
  const fields = jsonMembers(value)
  if (!fields) return null
  const partValues = fields.get('parts')
  if (partValues === undefined) return {}
  if (!Array.isArray(partValues)) return null
  const parts: Array<{ text?: string }> = []
  for (const part of partValues) {
    const text = jsonMembers(part)?.get('text')
    if (text !== undefined && !isJsonString(text)) return null
    parts.push(isJsonString(text) ? { text } : {})
  }
  return { parts }
}

function parseUsageMetadata(
  value: JsonValue | undefined,
): GeminiContent['usageMetadata'] | null {
  if (value === undefined) return undefined
  const fields = jsonMembers(value)
  if (!fields) return null
  const promptTokenCount = fields.get('promptTokenCount')
  if (
    promptTokenCount !== undefined &&
    !isJsonNumber(promptTokenCount)
  ) {
    return null
  }
  return isJsonNumber(promptTokenCount)
    ? { promptTokenCount }
    : {}
}
