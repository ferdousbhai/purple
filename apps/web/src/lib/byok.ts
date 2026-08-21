/**
 * Bring-your-own-key mode: the visitor's Gemini API key lives only in this
 * browser's localStorage and every request goes straight from the browser to
 * Google's API. Purple's servers are never in the path — the key is sent in a
 * request header (never a URL) and is never transmitted to, logged by, or
 * recoverable from Purple.
 */

import {
  COMPACTION_PROMPT,
  COMPACTION_SCHEMA,
  DEFAULT_GEMINI_MODEL,
  SYSTEM_PROMPT,
  TITLE_PROMPT,
  TITLE_SCHEMA,
  TRANSITION_SUGGESTIONS_PROMPT,
  TRANSITION_SUGGESTIONS_SCHEMA,
  buildCompactionRequest,
  buildTransitionSuggestionsRequest,
  errorMessage,
  parseCompactionSummary,
  parseGeneratedPatternTitle,
  parseTransitionSuggestions,
  type CompactionArtifact,
  type CompactionSummarizer,
  type ResponseSchema,
} from '@purple/core'
import type {
  ChatMessage,
  PatternGenerator,
  TitleGenerator,
  TransitionSuggester,
} from '@purple/core/types'
import { z } from 'zod'

const STORAGE_KEY = 'purple.byok.gemini-key'
const CHAT_STORAGE_KEY = 'purple.byok.chat'

// One-time adoption of the pre-rebrand keys (the app shipped as Riff through
// 0.3.x), so a returning visitor keeps their key and chat.
try {
  if ('window' in globalThis) {
    for (const [legacy, current] of [
      ['riff.byok.gemini-key', STORAGE_KEY],
      ['riff.byok.chat', CHAT_STORAGE_KEY],
    ] as const) {
      const value = window.localStorage.getItem(legacy)
      if (value !== null) {
        if (window.localStorage.getItem(current) === null) {
          window.localStorage.setItem(current, value)
        }
        window.localStorage.removeItem(legacy)
      }
    }
  }
} catch {
  // Storage unavailable (private mode); nothing to migrate.
}
/**
 * Persistence cap only — the context sent to Gemini is bounded separately by
 * buildContextWindow. Keeps the stored transcript from growing localStorage
 * without limit.
 */
const MAX_STORED_MESSAGES = 200
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`

/** The BYOK chat a browser carries across reloads. */
export interface ByokChatState {
  messages: ChatMessage[]
  /** Rolling compaction summary, or null before the first fold. */
  artifact: CompactionArtifact | null
  /** How many leading messages the artifact covers. */
  coveredCount: number
}

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
  content: z.string(),
})

const storedArtifactSchema = z.object({
  summary: z.string(),
  latestPattern: z.string(),
})

/** Versioned envelope: anything that does not match is discarded silently. */
const chatEnvelopeSchema = z.object({
  v: z.literal(2),
  messages: z.array(storedMessageSchema),
  artifact: storedArtifactSchema.nullable(),
  coveredCount: z.number().int().min(0),
})

/** The v1 envelope stored messages as `{role, text}` before the app unified
 * on core's `ChatMessage`; parsing migrates it in place of discarding. */
const legacyChatEnvelopeSchema = z.object({
  v: z.literal(1),
  messages: z.array(
    z.object({ role: z.enum(['user', 'assistant']), text: z.string() }),
  ),
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
    v: 2,
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
  if (parsed.success) {
    const { messages, artifact, coveredCount } = parsed.data
    return { messages, artifact, coveredCount: Math.min(coveredCount, messages.length) }
  }
  const legacy = legacyChatEnvelopeSchema.safeParse(value)
  if (!legacy.success) return null
  const messages = legacy.data.messages.map(({ role, text }) => ({
    role,
    content: text,
  }))
  return {
    messages,
    artifact: legacy.data.artifact,
    coveredCount: Math.min(legacy.data.coveredCount, messages.length),
  }
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

/**
 * The web app's backend: the shared capability interfaces it implements,
 * plus the repair round-trip the shared repair loop plugs into.
 */
export interface ByokBackend
  extends PatternGenerator,
    TitleGenerator,
    TransitionSuggester,
    CompactionSummarizer {
  /** Send a prepared repair message; resolves with the raw model text. */
  repairPattern(message: string): Promise<string>
}

/** Bind the visitor's key into a backend the studio UI talks to. */
export function createByokBackend(key: string): ByokBackend {
  return {
    generatePattern: (messages) => callGemini(key, SYSTEM_PROMPT, messages),

    repairPattern: (message) =>
      callGemini(key, SYSTEM_PROMPT, [{ role: 'user', content: message }]),

    async generateTitle(prompt) {
      try {
        const raw = await callGemini(
          key,
          TITLE_PROMPT,
          [{ role: 'user', content: prompt.trim() }],
          {
            responseMimeType: 'application/json',
            responseJsonSchema: TITLE_SCHEMA,
          },
        )
        const title = parseGeneratedPatternTitle(raw)
        if (!title) {
          return { ok: false, error: 'Gemini returned an invalid pattern title.' }
        }
        return { ok: true, title }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },

    async suggestTransitions(code, sourcePrompt) {
      try {
        const raw = await callGemini(
          key,
          TRANSITION_SUGGESTIONS_PROMPT,
          [{ role: 'user', content: buildTransitionSuggestionsRequest(code, sourcePrompt) }],
          {
            responseMimeType: 'application/json',
            responseJsonSchema: TRANSITION_SUGGESTIONS_SCHEMA,
          },
        )
        const suggestions = parseTransitionSuggestions(raw)
        if (!suggestions) {
          return { ok: false, error: 'Gemini returned invalid transition suggestions.' }
        }
        return { ok: true, suggestions }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },

    async generateCompactionSummary(previous, messages) {
      try {
        const raw = await callGemini(
          key,
          COMPACTION_PROMPT,
          [{ role: 'user', content: buildCompactionRequest(previous, messages) }],
          { responseMimeType: 'application/json', responseJsonSchema: COMPACTION_SCHEMA },
        )
        const artifact = parseCompactionSummary(raw)
        if (!artifact) {
          return { ok: false, error: 'Gemini returned an invalid session summary.' }
        }
        return { ok: true, artifact }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  }
}

async function callGemini(
  key: string,
  system: string,
  messages: readonly ChatMessage[],
  generationConfig?: GeminiGenerationConfig,
): Promise<string> {
  const body: GeminiRequestBody = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    generationConfig,
  }
  // Low thinking mirrors the desktop's GEMINI_THINKING_LEVEL default and cuts
  // seconds of server-side latency. Thinking levels are a Gemini 3 feature.
  if (DEFAULT_GEMINI_MODEL.startsWith('gemini-3')) {
    body.generationConfig = {
      thinkingConfig: { thinkingLevel: 'low' },
      ...generationConfig,
    }
  }
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
