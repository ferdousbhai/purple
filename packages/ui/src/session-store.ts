/**
 * One persistence story for a studio session: the chat transcript and the
 * working pattern survive reloads together in localStorage. The web app layers
 * its BYOK rules, including key-scoped chat and legacy key migration, on top in
 * `apps/web/src/lib/byok.ts`.
 */
import { MAX_PATTERN_LENGTH } from "@purple/core/pattern";
import { isShareId } from "@purple/core/shared-pattern";
import {
  isJsonNumber,
  isJsonString,
  jsonMembers,
  type JsonValue,
} from "@purple/core/json";
import type { StudioChatState } from "./use-studio-chat";

/**
 * Persistence target only - the context sent to the model is bounded
 * separately by buildContextWindow. Covered messages may be trimmed after
 * compaction, while uncovered messages are always retained.
 */
const MAX_STORED_MESSAGES = 200;

interface StoredArtifact {
  summary: string;
  latestPattern: string;
}

interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

/** Versioned envelope: anything that does not match is discarded silently. */
interface ChatEnvelope {
  v: 2;
  messages: StoredMessage[];
  artifact: StoredArtifact | null;
  coveredCount: number;
}

/** The v1 envelope stored messages as `{role, text}` before the app unified
 * on core's `ChatMessage`; parsing migrates it in place of discarding. */
interface LegacyStoredMessage {
  role: "user" | "assistant";
  text: string;
}

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
  let value: JsonValue;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const current = parseCurrentChatEnvelope(value);
  if (current) {
    const { messages, artifact, coveredCount } = current;
    return { messages, artifact, coveredCount: Math.min(coveredCount, messages.length) };
  }
  const legacy = parseLegacyChatEnvelope(value);
  if (!legacy) return null;
  const messages = legacy.messages.map(({ role, text }) => ({
    role,
    content: text,
  }));
  return {
    messages,
    artifact: legacy.artifact,
    coveredCount: Math.min(legacy.coveredCount, messages.length),
  };
}

function parseCurrentChatEnvelope(value: JsonValue): ChatEnvelope | null {
  const parsed = parseChatEnvelopeFields(value, 2, parseStoredMessages);
  return parsed ? { v: 2, ...parsed } : null;
}

interface ParsedChatEnvelope<Message> {
  messages: Message[];
  artifact: StoredArtifact | null;
  coveredCount: number;
}

function parseChatEnvelopeFields<Message>(
  value: JsonValue,
  version: 1 | 2,
  parseMessages: (value: JsonValue | undefined) => Message[] | null,
): ParsedChatEnvelope<Message> | null {
  const fields = jsonMembers(value);
  if (!fields || fields.get("v") !== version) return null;
  const messages = parseMessages(fields.get("messages"));
  const artifact = parseStoredArtifact(fields.get("artifact"));
  const coveredCount = parseCount(fields.get("coveredCount"));
  if (!messages || artifact === undefined || coveredCount === null) return null;
  return { messages, artifact, coveredCount };
}

function parseLegacyChatEnvelope(value: JsonValue): {
  messages: LegacyStoredMessage[];
  artifact: StoredArtifact | null;
  coveredCount: number;
} | null {
  return parseChatEnvelopeFields(value, 1, parseLegacyStoredMessages);
}

function parseStoredMessages(value: JsonValue | undefined): StoredMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: StoredMessage[] = [];
  for (const candidate of value) {
    const fields = jsonMembers(candidate);
    const role = fields?.get("role");
    const content = fields?.get("content");
    if (
      (role !== "user" && role !== "assistant") ||
      !isJsonString(content)
    ) return null;
    messages.push({ role, content });
  }
  return messages;
}

function parseLegacyStoredMessages(
  value: JsonValue | undefined,
): LegacyStoredMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: LegacyStoredMessage[] = [];
  for (const candidate of value) {
    const fields = jsonMembers(candidate);
    const role = fields?.get("role");
    const text = fields?.get("text");
    if ((role !== "user" && role !== "assistant") || !isJsonString(text)) {
      return null;
    }
    messages.push({ role, text });
  }
  return messages;
}

function parseStoredArtifact(
  value: JsonValue | undefined,
): StoredArtifact | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const fields = jsonMembers(value);
  const summary = fields?.get("summary");
  const latestPattern = fields?.get("latestPattern");
  if (!isJsonString(summary) || !isJsonString(latestPattern)) {
    return undefined;
  }
  return { summary, latestPattern };
}

function parseCount(value: JsonValue | undefined): number | null {
  return isJsonNumber(value) && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * The pattern the editor holds, restored alongside the chat on the next
 * launch. The code keeps the library's hard bounds; title and prompt clamp
 * instead of rejecting so an over-long title never blocks persisting the
 * pattern itself.
 */
export interface SessionPattern {
  code: string;
  customTitle: string | null;
  sourcePrompt?: string;
  shareId?: string;
}

function parseSessionPattern(value: JsonValue): SessionPattern | null {
  const fields = jsonMembers(value);
  const code = fields?.get("code");
  const customTitle = fields?.get("customTitle");
  const sourcePrompt = fields?.get("sourcePrompt");
  const shareId = fields?.get("shareId");
  if (
    !isJsonString(code) ||
    code.length === 0 ||
    code.length > MAX_PATTERN_LENGTH ||
    (customTitle !== null && !isJsonString(customTitle)) ||
    (sourcePrompt !== undefined && !isJsonString(sourcePrompt)) ||
    (shareId !== undefined && (!isJsonString(shareId) || !isShareId(shareId)))
  ) {
    return null;
  }
  const pattern: SessionPattern = {
    code,
    customTitle:
      isJsonString(customTitle)
        ? customTitle.slice(0, 60)
        : null,
  };
  if (isJsonString(sourcePrompt)) {
    pattern.sourcePrompt = sourcePrompt.slice(0, 4_000);
  }
  if (isJsonString(shareId)) pattern.shareId = shareId;
  return pattern;
}

function normalizeSessionPattern(pattern: SessionPattern): SessionPattern | null {
  if (
    pattern.code.length === 0 ||
    pattern.code.length > MAX_PATTERN_LENGTH ||
    (pattern.shareId !== undefined && !isShareId(pattern.shareId))
  ) {
    return null;
  }
  const normalized: SessionPattern = {
    code: pattern.code,
    customTitle: pattern.customTitle?.slice(0, 60) ?? null,
  };
  if (pattern.sourcePrompt !== undefined) {
    normalized.sourcePrompt = pattern.sourcePrompt.slice(0, 4_000);
  }
  if (pattern.shareId !== undefined) normalized.shareId = pattern.shareId;
  return normalized;
}

/** The editor calls save() on every change; the trailing
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
  let pendingPattern: { value: SessionPattern | null } | undefined;
  return {
    load() {
      if (pendingPattern) {
        return pendingPattern.value ? { ...pendingPattern.value } : null;
      }
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return null;
        return parseSessionPattern(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    save(pattern) {
      clearTimeout(pendingSave);
      const empty = !pattern.code.trim();
      const valid = empty ? null : normalizeSessionPattern(pattern);
      if (!empty && !valid) {
        pendingPattern = undefined;
        pendingSave = undefined;
        return;
      }
      pendingPattern = { value: valid };
      pendingSave = setTimeout(() => {
        const queued = pendingPattern;
        pendingPattern = undefined;
        pendingSave = undefined;
        if (!queued) return;
        try {
          // An emptied editor forgets the stored pattern rather than
          // resurrecting the previous one on the next launch; an out-of-bounds
          // one keeps the last good copy.
          if (!queued.value) {
            window.localStorage.removeItem(key);
            return;
          }
          window.localStorage.setItem(key, JSON.stringify(queued.value));
        } catch {
          // Storage unavailable (private mode); the session lives only in this tab.
        }
      }, PATTERN_SAVE_DEBOUNCE_MS);
    },
  };
}
