/**
 * Bring-your-own-key mode: the visitor's Gemini API key lives only in this
 * browser's localStorage and every request goes straight from the browser to
 * Google's API. Riff's servers are never in the path — the key is sent in a
 * request header (never a URL) and is never transmitted to, logged by, or
 * recoverable from Riff.
 */

import {
  COMPACTION_PROMPT,
  COMPACTION_SCHEMA,
  DEFAULT_GEMINI_MODEL,
  SYSTEM_PROMPT,
  TRANSITION_SUGGESTIONS_PROMPT,
  TRANSITION_SUGGESTIONS_SCHEMA,
  buildCompactionRequest,
  buildContextWindow,
  buildRetryMessage,
  buildTransitionSuggestionsRequest,
  parseCompactionSummary,
  parseTransitionSuggestions,
  type CompactionArtifact,
  type ResponseSchema,
  type TransitionSuggestion,
} from '@riff/core'
import type { ChatMessage } from '@riff/core/types'
import { z } from 'zod'

const STORAGE_KEY = 'riff.byok.gemini-key'
const CHAT_STORAGE_KEY = 'riff.byok.chat'
/**
 * Persistence cap only — the context sent to Gemini is bounded separately by
 * buildContextWindow. Keeps the stored transcript from growing localStorage
 * without limit.
 */
const MAX_STORED_MESSAGES = 200
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`

export interface ByokMessage {
  role: 'user' | 'assistant'
  text: string
}

/** The BYOK chat a browser carries across reloads. */
export interface ByokChatState {
  messages: ByokMessage[]
  /** Rolling compaction summary, or null before the first fold. */
  artifact: CompactionArtifact | null
  /** How many leading messages the artifact covers. */
  coveredCount: number
}

function toChatMessage({ role, text }: ByokMessage): ChatMessage {
  return { role, content: text }
}

function toByokMessage({ role, content }: ChatMessage): ByokMessage {
  return { role, text: content }
}

/** The generation knobs this client sets on Gemini's generateContent call. */
interface GeminiGenerationConfig {
  responseMimeType: string
  responseJsonSchema: ResponseSchema
}

interface GeminiRequestBody {
  systemInstruction: { parts: Array<{ text: string }> }
  contents: Array<{ role: 'model' | 'user'; parts: Array<{ text: string }> }>
  generationConfig?: GeminiGenerationConfig
}

/**
 * Gemini's wire shapes, decoded at the fetch boundary. Anything Gemini sends
 * that does not match — an HTML error page, a truncated body — decodes to the
 * empty object, which the callers below already handle as "no usable text".
 */
const geminiErrorSchema = z
  .object({ error: z.object({ message: z.string().optional() }).optional() })
  .catch({})

const geminiContentSchema = z
  .object({
    candidates: z
      .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional() }))
      .optional(),
  })
  .catch({})

export function getByokKey(): string | null {
  try {
    const key = window.localStorage.getItem(STORAGE_KEY)
    return key && key.trim() ? key.trim() : null
  } catch {
    return null
  }
}

export function setByokKey(key: string | null): void {
  try {
    if (key && key.trim()) window.localStorage.setItem(STORAGE_KEY, key.trim())
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode); the key simply won't persist.
  }
}

const storedMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
})

const storedArtifactSchema = z.object({
  summary: z.string(),
  latestPattern: z.string(),
})

/** Versioned envelope: anything that does not match is discarded silently. */
const chatEnvelopeSchema = z.object({
  v: z.literal(1),
  messages: z.array(storedMessageSchema),
  artifact: storedArtifactSchema.nullable(),
  coveredCount: z.number().int().min(0),
})

type ByokChatEnvelope = z.infer<typeof chatEnvelopeSchema>

/**
 * The envelope written to localStorage: last MAX_STORED_MESSAGES messages,
 * with coveredCount shifted down by however many covered messages the cap
 * dropped. Dropping covered messages keeps the artifact valid — it then
 * summarizes a superset of what precedes the stored transcript.
 */
export function toChatEnvelope(state: ByokChatState): ByokChatEnvelope {
  const dropped = Math.max(0, state.messages.length - MAX_STORED_MESSAGES)
  const covered = Math.min(Math.max(state.coveredCount, 0), state.messages.length)
  return {
    v: 1,
    messages: state.messages.slice(dropped),
    artifact: state.artifact,
    coveredCount: Math.max(0, covered - dropped),
  }
}

/** Decode a stored envelope; null for anything malformed or from another version. */
export function parseChatEnvelope(raw: string): ByokChatState | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = chatEnvelopeSchema.safeParse(value)
  if (!parsed.success) return null
  const { messages, artifact, coveredCount } = parsed.data
  return { messages, artifact, coveredCount: Math.min(coveredCount, messages.length) }
}

export function loadByokChat(): ByokChatState | null {
  try {
    // A transcript with no key alongside it is an orphan — the key was
    // removed out-of-band (another tab, devtools), and without a key the
    // composer that could clear it never renders. Purge instead of loading.
    if (getByokKey() === null) {
      window.localStorage.removeItem(CHAT_STORAGE_KEY)
      return null
    }
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY)
    return raw ? parseChatEnvelope(raw) : null
  } catch {
    return null
  }
}

export function saveByokChat(state: ByokChatState): void {
  try {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toChatEnvelope(state)))
  } catch {
    // Storage unavailable (private mode); the chat simply won't persist.
  }
}

export function clearByokChat(): void {
  try {
    window.localStorage.removeItem(CHAT_STORAGE_KEY)
  } catch {
    // Nothing stored to clear.
  }
}

export async function byokGeneratePattern(
  key: string,
  history: readonly ByokMessage[],
  compaction?: Pick<ByokChatState, 'artifact' | 'coveredCount'>,
): Promise<string> {
  const contextWindow = buildContextWindow(
    compaction?.artifact ?? null,
    compaction?.coveredCount ?? 0,
    history.map(toChatMessage),
  )
  return callGemini(key, SYSTEM_PROMPT, contextWindow.map(toByokMessage))
}

/**
 * Fold older chat messages into a rolling session summary. Runs in the
 * background after a generation settles; the caller keeps its previous
 * compaction state when this throws.
 */
export async function generateCompactionSummary(
  key: string,
  previous: CompactionArtifact | null,
  messages: readonly ByokMessage[],
): Promise<CompactionArtifact> {
  const raw = await callGemini(
    key,
    COMPACTION_PROMPT,
    [{ role: 'user', text: buildCompactionRequest(previous, messages.map(toChatMessage)) }],
    { responseMimeType: 'application/json', responseJsonSchema: COMPACTION_SCHEMA },
  )
  const artifact = parseCompactionSummary(raw)
  if (!artifact) throw new Error('Gemini returned an invalid session summary.')
  return artifact
}

export async function byokRepairPattern(
  key: string,
  code: string,
  error: string,
): Promise<string> {
  return callGemini(key, SYSTEM_PROMPT, [
    { role: 'user', text: buildRetryMessage(code, error) },
  ])
}

export async function byokSuggestTransitions(
  key: string,
  code: string,
  sourcePrompt?: string,
): Promise<TransitionSuggestion[]> {
  const raw = await callGemini(
    key,
    TRANSITION_SUGGESTIONS_PROMPT,
    [{ role: 'user', text: buildTransitionSuggestionsRequest(code, sourcePrompt) }],
    {
      responseMimeType: 'application/json',
      responseJsonSchema: TRANSITION_SUGGESTIONS_SCHEMA,
    },
  )
  const suggestions = parseTransitionSuggestions(raw)
  if (!suggestions) throw new Error('Gemini returned invalid transition suggestions.')
  return suggestions
}

async function callGemini(
  key: string,
  system: string,
  messages: readonly ByokMessage[],
  generationConfig?: GeminiGenerationConfig,
): Promise<string> {
  const body: GeminiRequestBody = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.text }],
    })),
  }
  if (generationConfig) body.generationConfig = generationConfig
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = `Gemini request failed (${response.status}).`
    try {
      const payload = geminiErrorSchema.parse(await response.json())
      if (payload.error?.message) detail = payload.error.message
    } catch {
      // Keep the status-based message.
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      detail += ' Check that your Gemini API key is valid.'
    }
    throw new Error(detail)
  }
  const data = geminiContentSchema.parse(await response.json())
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
  if (!text) throw new Error('Gemini returned an empty response.')
  return text
}
