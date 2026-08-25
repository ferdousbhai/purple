import {
  isJsonNumber,
  isJsonString,
  jsonMembers,
  jsonText,
  type JsonValue,
} from "./json";
import { MAX_PATTERN_LENGTH } from "./pattern";

export const MAX_SHARED_TITLE_LENGTH = 60;
export const PATTERN_PAGE_SIZE = 12;

export type PatternSort = "fresh" | "top";
export type PatternVote = -1 | 0 | 1;

export interface SharedPatternDraft {
  title: string;
  code: string;
}

export interface SharedPattern extends SharedPatternDraft {
  id: string;
  createdAt: number;
  likes: number;
  dislikes: number;
  score: number;
  viewerVote: PatternVote;
}

export interface SharedPatternPage {
  patterns: SharedPattern[];
  nextCursor: string | null;
}

export interface PatternVoteResult {
  likes: number;
  dislikes: number;
  score: number;
  viewerVote: PatternVote;
}

const SHARE_ID = /^[A-Za-z0-9_-]{12}$/;

export function isShareId(value: string): boolean {
  return SHARE_ID.test(value);
}

export function parsePatternSort(value: string | null): PatternSort {
  return value === "top" ? "top" : "fresh";
}

export function parseSharedPatternDraft(value: JsonValue): SharedPatternDraft | null {
  const fields = jsonMembers(value);
  return fields ? parseDraftMembers(fields) : null;
}

function parseDraftMembers(
  fields: ReadonlyMap<string, JsonValue>,
): SharedPatternDraft | null {
  const title = jsonText(fields.get("title"))?.trim();
  const code = jsonText(fields.get("code"))?.trim();
  if (
    !title ||
    title.length > MAX_SHARED_TITLE_LENGTH ||
    title.includes("\n") ||
    !code ||
    code.length > MAX_PATTERN_LENGTH
  ) return null;
  return { title, code };
}

export function parseSharedPattern(value: JsonValue): SharedPattern | null {
  const fields = jsonMembers(value);
  if (!fields) return null;
  const draft = parseDraftMembers(fields);
  const id = jsonText(fields.get("id"));
  const createdAt = integer(fields.get("createdAt"), 0);
  const vote = parseVoteMembers(fields);
  if (
    !draft ||
    !id ||
    !isShareId(id) ||
    createdAt === null ||
    !vote
  ) return null;
  return { id, ...draft, createdAt, ...vote };
}

export function parseSharedPatternPage(value: JsonValue): SharedPatternPage | null {
  const fields = jsonMembers(value);
  if (!fields) return null;
  const candidates = fields.get("patterns");
  if (!Array.isArray(candidates)) return null;
  const patterns: SharedPattern[] = [];
  for (const candidate of candidates) {
    const pattern = parseSharedPattern(candidate);
    if (!pattern) return null;
    patterns.push(pattern);
  }
  const cursor = fields.get("nextCursor");
  if (cursor !== null && !isJsonString(cursor)) return null;
  return { patterns, nextCursor: cursor };
}

export function parsePatternVoteResult(value: JsonValue): PatternVoteResult | null {
  const fields = jsonMembers(value);
  return fields ? parseVoteMembers(fields) : null;
}

function parseVoteMembers(
  fields: ReadonlyMap<string, JsonValue>,
): PatternVoteResult | null {
  const likes = integer(fields.get("likes"), 0);
  const dislikes = integer(fields.get("dislikes"), 0);
  const score = signedInteger(fields.get("score"));
  const viewerVote = patternVote(fields.get("viewerVote"));
  if (
    likes === null ||
    dislikes === null ||
    score === null ||
    viewerVote === null
  ) return null;
  return { likes, dislikes, score, viewerVote };
}

function integer(value: JsonValue | undefined, minimum: number): number | null {
  return isJsonNumber(value) && Number.isInteger(value) && value >= minimum
    ? value
    : null;
}

function signedInteger(value: JsonValue | undefined): number | null {
  return isJsonNumber(value) && Number.isInteger(value) ? value : null;
}

function patternVote(value: JsonValue | undefined): PatternVote | null {
  return value === -1 || value === 0 || value === 1 ? value : null;
}
