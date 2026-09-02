/**
 * Bring-your-own-key mode: the visitor's Gemini API key lives only in this
 * browser's localStorage and every request goes straight from the browser to
 * Google's API. Purple's servers are never in the path - the key is sent in a
 * request header (never a URL) and is never transmitted to, logged by, or
 * recoverable from Purple.
 */

import {
  COMPACTION_PROMPT,
  COMPACTION_SCHEMA,
  DEFAULT_GEMINI_MODEL,
  GENERATED_TURN_SCHEMA,
  REPAIR_PATTERN_SCHEMA,
  REPAIR_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildCompactionRequest,
  createPatternStreamDecoder,
  errorMessage,
  parseCompactionSummary,
  parseGeneratedTurn,
  validatePatternCode,
  type CompactionSummarizer,
  type ResponseSchema,
} from '@purple/core'
import type {
  ChatMessage,
  PatternStreamer,
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

export type ByokChatState = StudioChatState

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

interface ByokBackend
  extends CompactionSummarizer,
    PatternStreamer {
  repairPattern(message: string): Promise<string>
  abortRepair(): void
  abortCompaction(): void
}

export function createByokBackend(key: string): ByokBackend {
  let activeStream: AbortController | null = null
  let activeRepair: AbortController | null = null
  let activeCompaction: AbortController | null = null

  return {
    // Compaction remains a rare, background structured call after the exact
    // token threshold. Normal turn metadata travels with the pattern stream.
    async generateCompactionSummary(previous, messages) {
      activeCompaction?.abort()
      const controller = new AbortController()
      activeCompaction = controller
      try {
        const raw = await callGemini(
          key,
          COMPACTION_PROMPT,
          [{
            role: 'user',
            content: buildCompactionRequest(previous, messages),
          }],
          {
            responseMimeType: 'application/json',
            responseJsonSchema: COMPACTION_SCHEMA,
          },
          controller.signal,
        )
        const artifact = parseCompactionSummary(raw)
        return artifact
          ? { ok: true, artifact }
          : { ok: false, error: 'Gemini returned an invalid session summary.' }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      } finally {
        if (activeCompaction === controller) activeCompaction = null
      }
    },

    abortCompaction() {
      activeCompaction?.abort()
      activeCompaction = null
    },

    async stream(messages, callbacks) {
      activeStream?.abort()
      const controller = new AbortController()
      activeStream = controller
      const decoder = createPatternStreamDecoder({
        onDelta: callbacks.onPatternDelta,
        onComplete: callbacks.onPatternComplete,
      })
      try {
        const { text, promptTokens, truncated } = await streamGemini(
          key,
          SYSTEM_PROMPT,
          messages,
          (delta) => decoder.push(delta),
          controller.signal,
          {
            responseMimeType: 'application/json',
            responseJsonSchema: GENERATED_TURN_SCHEMA,
          },
        )
        const turn = parseGeneratedTurn(text, decoder.pattern() ?? undefined)
        if (!turn) {
          throw new Error(
            truncated
              ? 'Gemini reached its output limit before completing the Strudel pattern. Please try again.'
              : 'Gemini did not return a valid Strudel pattern.',
          )
        }
        return { turn, promptTokens }
      } finally {
        if (activeStream === controller) activeStream = null
      }
    },

    async abortStream() {
      activeStream?.abort()
      activeStream = null
    },

    abortRepair() {
      activeRepair?.abort()
      activeRepair = null
    },

    async repairPattern(message) {
      activeRepair?.abort()
      const controller = new AbortController()
      activeRepair = controller
      try {
        const raw = await callGemini(
          key,
          REPAIR_SYSTEM_PROMPT,
          [{ role: 'user', content: message }],
          {
            responseMimeType: 'application/json',
            responseJsonSchema: REPAIR_PATTERN_SCHEMA,
          },
          controller.signal,
        )
        const pattern = parseRepairPattern(raw)
        if (!pattern) {
          throw new Error('Gemini did not return a valid repaired pattern.')
        }
        return pattern
      } finally {
        if (activeRepair === controller) activeRepair = null
      }
    },
  }
}

function parseRepairPattern(response: string): string | null {
  try {
    const parsed: JsonValue = JSON.parse(response)
    const pattern = jsonMembers(parsed)?.get('pattern')
    return isJsonString(pattern) ? validatePatternCode(pattern) : null
  } catch {
    return null
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
  const message = geminiErrorMessage(await readGeminiErrorBody(response))
  if (message) detail = message
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    detail += ' Check that your Gemini API key is valid.'
  }
  throw new Error(detail)
}

async function readGeminiErrorBody(response: Response): Promise<JsonValue | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
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
  callerSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  if (callerSignal?.aborted) controller.abort()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
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
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

interface StreamedGeneration {
  text: string
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
  generationConfig?: GeminiGenerationConfig,
): Promise<StreamedGeneration> {
  const response = await fetch(`${STREAM_ENDPOINT}?alt=sse`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify(buildRequestBody(system, messages, generationConfig)),
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
  return { text: total, promptTokens, truncated }
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
