/**
 * The working pattern survives a reload: the editor's code, title, and share
 * identity in localStorage, written behind a trailing debounce.
 */
import { MAX_PATTERN_LENGTH, MAX_TITLE_LENGTH } from "@purple/core/pattern";
import { isShareId } from "@purple/core/shared-pattern";
import { isJsonString, jsonMembers, type JsonValue } from "@purple/core/json";

/**
 * The pattern the editor holds, restored on the next launch. The code keeps
 * the library's hard bounds; the title clamps instead of rejecting so an
 * over-long one never blocks persisting the pattern itself.
 */
interface SessionPattern {
  code: string;
  customTitle: string | null;
  /** Public id of this exact title and code, when they still match a share. */
  shareId?: string;
  /** Last public id this working copy came from, kept after local edits. */
  originShareId?: string;
}

function parseSessionPattern(value: JsonValue): SessionPattern | null {
  const fields = jsonMembers(value);
  const code = fields?.get("code");
  const customTitle = fields?.get("customTitle");
  const shareId = fields?.get("shareId");
  const originShareId = fields?.get("originShareId");
  if (
    !isJsonString(code) ||
    (customTitle !== null && !isJsonString(customTitle)) ||
    !isOptionalJsonString(shareId) ||
    !isOptionalJsonString(originShareId)
  ) {
    return null;
  }
  // Only the JSON shapes are checked here; normalizeSessionPattern owns the
  // bounds, the share-id check, and the title clamp for both paths.
  return normalizeSessionPattern({
    code,
    customTitle: isJsonString(customTitle) ? customTitle : null,
    ...optionalShareIds(shareId, originShareId),
  });
}

function normalizeSessionPattern(pattern: SessionPattern): SessionPattern | null {
  if (
    pattern.code.length === 0 ||
    pattern.code.length > MAX_PATTERN_LENGTH ||
    isInvalidShareId(pattern.shareId) ||
    isInvalidShareId(pattern.originShareId)
  ) {
    return null;
  }
  return {
    code: pattern.code,
    customTitle: pattern.customTitle?.slice(0, MAX_TITLE_LENGTH) ?? null,
    ...optionalShareIds(pattern.shareId, pattern.originShareId),
  };
}

function optionalShareIds(
  shareId: string | undefined,
  originShareId: string | undefined,
): Pick<SessionPattern, "shareId" | "originShareId"> {
  const ids: Pick<SessionPattern, "shareId" | "originShareId"> = {};
  if (shareId !== undefined) ids.shareId = shareId;
  if (originShareId !== undefined) ids.originShareId = originShareId;
  return ids;
}

function isInvalidShareId(value: string | undefined): boolean {
  return value !== undefined && !isShareId(value);
}

function isOptionalJsonString(value: JsonValue | undefined): value is string | undefined {
  return value === undefined || isJsonString(value);
}

/** The editor calls save() on every change; the trailing
 * debounce keeps typing from issuing a synchronous storage write per keystroke. */
const PATTERN_SAVE_DEBOUNCE_MS = 300;

interface PatternStore {
  load(): SessionPattern | null;
  save(pattern: SessionPattern): void;
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
