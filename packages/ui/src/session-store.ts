/**
 * One persistence story for a studio session: the chat transcript and the
 * working pattern survive restarts together, in the webview's localStorage.
 * Both apps share this module - the web app layers its BYOK rules (key-scoped
 * chat, legacy key migration) on top in `apps/web/src/lib/byok.ts`, while the
 * desktop uses the defaults; its Rust shell never sees this data.
 */
import { z } from "zod";
import { MAX_PATTERN_LENGTH } from "@purple/core";
import type { StudioChatState } from "./use-studio-chat";

/**
 * Persistence target only - the context sent to the model is bounded
 * separately by buildContextWindow. Covered messages may be trimmed after
 * compaction, while uncovered messages are always retained.
 */
const MAX_STORED_MESSAGES = 200;

const storedMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const storedArtifactSchema = z.object({
  summary: z.string(),
  latestPattern: z.string(),
});

/** Versioned envelope: anything that does not match is discarded silently. */
const chatEnvelopeSchema = z.object({
  v: z.literal(2),
  messages: z.array(storedMessageSchema),
  artifact: storedArtifactSchema.nullable(),
  coveredCount: z.number().int().min(0),
});

/** The v1 envelope stored messages as `{role, text}` before the app unified
 * on core's `ChatMessage`; parsing migrates it in place of discarding. */
const legacyChatEnvelopeSchema = z.object({
  v: z.literal(1),
  messages: z.array(
    z.object({ role: z.enum(["user", "assistant"]), text: z.string() }),
  ),
  artifact: storedArtifactSchema.nullable(),
  coveredCount: z.number().int().min(0),
});

type ChatEnvelope = z.infer<typeof chatEnvelopeSchema>;

/**
 * The envelope written to localStorage. It aims for MAX_STORED_MESSAGES, but
 * only removes a prefix that the compaction artifact already represents. A
 * long uncovered tail is retained in full instead of silently losing chat.
 */
export function toChatEnvelope(state: StudioChatState): ChatEnvelope {
  const covered = Math.min(Math.max(state.coveredCount, 0), state.messages.length);
  const represented = state.artifact?.summary.trim() ? covered : 0;
  const dropped = Math.min(
    Math.max(0, state.messages.length - MAX_STORED_MESSAGES),
    represented,
  );
  return {
    v: 2,
    messages: state.messages.slice(dropped),
    artifact: state.artifact,
    coveredCount: Math.max(0, represented - dropped),
  };
}

/** Decode a stored envelope; null for anything malformed or from another version. */
export function parseChatEnvelope(raw: string): StudioChatState | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = chatEnvelopeSchema.safeParse(value);
  if (parsed.success) {
    const { messages, artifact, coveredCount } = parsed.data;
    return { messages, artifact, coveredCount: Math.min(coveredCount, messages.length) };
  }
  const legacy = legacyChatEnvelopeSchema.safeParse(value);
  if (!legacy.success) return null;
  const messages = legacy.data.messages.map(({ role, text }) => ({
    role,
    content: text,
  }));
  return {
    messages,
    artifact: legacy.data.artifact,
    coveredCount: Math.min(legacy.data.coveredCount, messages.length),
  };
}

/**
 * The pattern the editor holds, restored alongside the chat on the next
 * launch. The code keeps the library's hard bounds; title and prompt clamp
 * instead of rejecting so an over-long title never blocks persisting the
 * pattern itself.
 */
const sessionPatternSchema = z.object({
  code: z.string().min(1).max(MAX_PATTERN_LENGTH),
  customTitle: z
    .string()
    .transform((title) => title.slice(0, 60))
    .nullable(),
  sourcePrompt: z
    .string()
    .transform((prompt) => prompt.slice(0, 4_000))
    .optional(),
});

export type SessionPattern = z.infer<typeof sessionPatternSchema>;

/** Both apps mirror the editor into save() on every change; the trailing
 * debounce keeps typing from issuing a synchronous storage write per keystroke. */
const PATTERN_SAVE_DEBOUNCE_MS = 300;

export interface ChatStore {
  load(): StudioChatState | null;
  /** False when the browser blocks localStorage. */
  save(state: StudioChatState): boolean;
  clear(): boolean;
}

export interface PatternStore {
  load(): SessionPattern | null;
  save(pattern: SessionPattern): void;
}

export function createChatStore(key = "purple.chat"): ChatStore {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? parseChatEnvelope(raw) : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        window.localStorage.setItem(key, JSON.stringify(toChatEnvelope(state)));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function createPatternStore(key = "purple.session-pattern.v1"): PatternStore {
  let pendingSave: ReturnType<typeof setTimeout> | undefined;
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return null;
        const parsed = sessionPatternSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    save(pattern) {
      clearTimeout(pendingSave);
      pendingSave = setTimeout(() => {
        try {
          // An emptied editor forgets the stored pattern rather than
          // resurrecting the previous one on the next launch; an out-of-bounds
          // one keeps the last good copy.
          if (!pattern.code.trim()) {
            window.localStorage.removeItem(key);
            return;
          }
          const valid = sessionPatternSchema.safeParse(pattern);
          if (valid.success) {
            window.localStorage.setItem(key, JSON.stringify(valid.data));
          }
        } catch {
          // Storage unavailable (private mode); the session lives only in this tab.
        }
      }, PATTERN_SAVE_DEBOUNCE_MS);
    },
  };
}
