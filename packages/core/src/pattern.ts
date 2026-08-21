import { jsonMembers, jsonText, parseJsonMembers } from "./json";

export interface TransitionSuggestion {
  label: string;
  prompt: string;
}

/** Extract the last explicitly-labelled Strudel/JavaScript fenced block. */
export function extractPattern(text: string): string | null {
  const matches = [
    ...text.matchAll(/```(?:strudel|js|javascript)\s*\n([\s\S]*?)```/g),
  ];

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const code = matches[index]?.[1]?.trim();
    if (code) return code;
  }
  return null;
}

/** Patterns larger than this are rejected rather than landed in the editor. */
export const MAX_PATTERN_LENGTH = 30_000;

export type PatternAcceptance =
  | { ok: true; pattern: string }
  | { ok: false; error: string };

/**
 * Extract and size-guard the pattern from a raw model response — the shared
 * acceptance gate both apps run before a generated pattern reaches the
 * editor.
 */
export function acceptRawPattern(raw: string): PatternAcceptance {
  const pattern = extractPattern(raw);
  if (!pattern) {
    return { ok: false, error: "Gemini did not return a Strudel pattern." };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      error: "Gemini returned a pattern larger than 30,000 characters.",
    };
  }
  return { ok: true, pattern };
}

/** Hide complete and still-streaming fenced code while keeping assistant prose. */
export function visibleTextWithoutCodeBlocks(text: string): string {
  return text.replace(/(```[\s\S]*?```|```[\s\S]*$)/g, '').trim()
}

export function patternFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return `${slug || "purple-pattern"}.strudel`;
}

export function validateGeneratedPatternTitle(value: string): string | null {
  const title = value.trim();
  if (
    !title ||
    title.length > 60 ||
    title.includes("\n") ||
    title.includes("```") ||
    /^["'“”]|["'“”]$/.test(title)
  ) {
    return null;
  }
  return title;
}

/** Parse the raw JSON response produced under the title schema. */
export function parseGeneratedPatternTitle(value: string): string | null {
  const members = parseJsonMembers(value);
  if (members === null || members.size !== 1) return null;
  const title = jsonText(members.get("title"));
  return title === null ? null : validateGeneratedPatternTitle(title);
}

/** Parse the raw JSON response produced under the transition-suggestions schema. */
export function parseTransitionSuggestions(
  value: string,
): TransitionSuggestion[] | null {
  const members = parseJsonMembers(value);
  if (members === null || members.size !== 1) return null;
  const candidates = members.get("suggestions");
  if (!Array.isArray(candidates) || candidates.length !== 3) return null;

  const suggestions: TransitionSuggestion[] = [];
  for (const candidate of candidates) {
    const fields = jsonMembers(candidate);
    if (fields === null || fields.size !== 2) return null;

    const rawLabel = jsonText(fields.get("label"));
    const rawPrompt = jsonText(fields.get("prompt"));
    if (rawLabel === null || rawPrompt === null) return null;

    const label = rawLabel.trim();
    const prompt = rawPrompt.trim();
    if (
      !label ||
      label.length > 60 ||
      label.includes("\n") ||
      !prompt ||
      prompt.length > 1000 ||
      prompt.includes("\n")
    ) {
      return null;
    }
    suggestions.push({ label, prompt });
  }

  return new Set(suggestions.map(({ label }) => label.toLowerCase())).size === 3
    ? suggestions
    : null;
}
