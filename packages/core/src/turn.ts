import { jsonText, parseJsonMembers } from "./json";
import {
  validateTransitionSuggestions,
  validateGeneratedPatternTitle,
  validatePatternCode,
  type TransitionSuggestion,
} from "./pattern";
import {
  validatePatternProgression,
  type PatternProgression,
} from "./progression";

/** The single structured result produced for a normal studio turn. */
export interface GeneratedTurn {
  pattern: string;
  /** Missing or malformed planning metadata disables autonomous continuation. */
  progression: PatternProgression | null;
  /** Invalid or truncated optional metadata never discards a usable pattern. */
  title: string | null;
  suggestions: TransitionSuggestion[];
  explanation: string;
}

/**
 * Parse a complete structured turn. `fallbackPattern` is the pattern already
 * decoded from the leading JSON string, so a response truncated in later
 * metadata can still land usable music.
 */
export function parseGeneratedTurn(
  response: string,
  fallbackPattern?: string,
): GeneratedTurn | null {
  const members = parseJsonMembers(response);
  const rawPattern = members === null ? null : jsonText(members.get("pattern"));
  const pattern = validatePatternCode(rawPattern ?? fallbackPattern ?? "");
  if (pattern === null) return null;

  const progression = validatePatternProgression(members?.get("progression"));
  const rawTitle = members === null ? null : jsonText(members.get("title"));
  const title =
    rawTitle === null ? null : validateGeneratedPatternTitle(rawTitle);
  const rawExplanation =
    members === null ? null : jsonText(members.get("explanation"));
  const explanation = validateExplanation(rawExplanation);
  const suggestions =
    validateTransitionSuggestions(members?.get("suggestions")) ?? [];

  return { pattern, progression, title, suggestions, explanation };
}

function validateExplanation(value: string | null): string {
  if (value === null) return "";
  const explanation = value.trim();
  if (explanation.length > 500 || explanation.includes("```")) return "";
  return explanation;
}

/** Rebuild the established transcript format used by history and compaction. */
export function formatGeneratedTurn(turn: GeneratedTurn): string {
  const block = `\`\`\`strudel\n${turn.pattern}\n\`\`\``;
  const metadata = [
    turn.title ? `Title: ${turn.title}` : "",
    turn.explanation,
    turn.progression
      ? `Next after ${turn.progression.afterCycles} cycles: ${turn.progression.nextAction}`
      : "",
  ].filter(Boolean);
  return metadata.length > 0 ? `${block}\n${metadata.join("\n")}` : block;
}

interface DecodedPattern {
  value: string;
  complete: boolean;
}

export interface PatternStreamDecoder {
  push(chunk: string): void;
  /** The complete pattern, or null until its closing JSON quote arrives. */
  pattern(): string | null;
}

/**
 * Decode the leading `pattern` JSON string while the rest of the object is
 * still arriving. The decoder reparses the append-only prefix on each chunk,
 * which keeps split escapes and UTF-16 surrogate pairs correct without
 * exposing partial escape sequences to the editor.
 */
export function createPatternStreamDecoder(callbacks: {
  onDelta(delta: string): void;
  onComplete(pattern: string): void;
}): PatternStreamDecoder {
  let source = "";
  let emitted = "";
  let completedPattern: string | null = null;

  return {
    push(chunk) {
      if (completedPattern !== null || !chunk) return;
      source += chunk;
      const decoded = decodeLeadingPattern(source);
      if (decoded === null || !decoded.value.startsWith(emitted)) return;

      const delta = decoded.value.slice(emitted.length);
      emitted = decoded.value;
      if (delta) callbacks.onDelta(delta);

      if (!decoded.complete) return;
      completedPattern = validatePatternCode(decoded.value);
      if (completedPattern !== null) callbacks.onComplete(completedPattern);
    },
    pattern: () => completedPattern,
  };
}

function decodeLeadingPattern(source: string): DecodedPattern | null {
  let cursor = skipWhitespace(source, 0);
  if (source[cursor] !== "{") return null;
  cursor = skipWhitespace(source, cursor + 1);

  const key = decodeJsonString(source, cursor);
  if (key === null || !key.complete || key.value !== "pattern") return null;
  cursor = skipWhitespace(source, key.end);
  if (source[cursor] !== ":") return null;
  cursor = skipWhitespace(source, cursor + 1);
  return decodeJsonString(source, cursor);
}

interface DecodedJsonString extends DecodedPattern {
  end: number;
}

function decodeJsonString(
  source: string,
  openingQuote: number,
): DecodedJsonString | null {
  if (source[openingQuote] !== '"') return null;
  let value = "";

  for (let cursor = openingQuote + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === '"') {
      return { value, complete: true, end: cursor + 1 };
    }
    if (character !== "\\") {
      if (character !== undefined && character.charCodeAt(0) < 0x20) return null;
      value += character ?? "";
      continue;
    }

    const escaped = source[cursor + 1];
    if (escaped === undefined) {
      return { value, complete: false, end: source.length };
    }
    const simple = decodeSimpleEscape(escaped);
    if (simple !== null) {
      value += simple;
      cursor += 1;
      continue;
    }
    if (escaped !== "u") return null;

    const first = decodeUnicodeEscape(source, cursor);
    if (first === null) return { value, complete: false, end: source.length };
    cursor = first.end - 1;
    if (isHighSurrogate(first.codeUnit)) {
      const nextSlash = first.end;
      if (source.length === nextSlash) {
        return { value, complete: false, end: source.length };
      }
      if (source.slice(nextSlash, nextSlash + 2) === "\\u") {
        const second = decodeUnicodeEscape(source, nextSlash);
        if (second === null) {
          return { value, complete: false, end: source.length };
        }
        if (isLowSurrogate(second.codeUnit)) {
          value += String.fromCharCode(first.codeUnit, second.codeUnit);
          cursor = second.end - 1;
          continue;
        }
      } else if (
        source.length <= nextSlash + 1 &&
        source[nextSlash] === "\\"
      ) {
        return { value, complete: false, end: source.length };
      }
    }
    value += String.fromCharCode(first.codeUnit);
  }

  return { value, complete: false, end: source.length };
}

function decodeSimpleEscape(value: string): string | null {
  switch (value) {
    case '"':
      return '"';
    case "\\":
      return "\\";
    case "/":
      return "/";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return null;
  }
}

function decodeUnicodeEscape(
  source: string,
  slash: number,
): { codeUnit: number; end: number } | null {
  const digits = source.slice(slash + 2, slash + 6);
  if (digits.length < 4 || !/^[0-9a-f]{4}$/i.test(digits)) return null;
  return { codeUnit: Number.parseInt(digits, 16), end: slash + 6 };
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

function skipWhitespace(value: string, start: number): number {
  let cursor = start;
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;
  return cursor;
}
