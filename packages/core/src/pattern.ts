import { jsonMembers, jsonText, type JsonValue } from "./json";

export interface TransitionSuggestion {
  label: string;
  prompt: string;
}

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

export function validatePatternCode(value: string): string | null {
  const pattern = value.trim();
  return pattern && pattern.length <= MAX_PATTERN_LENGTH ? pattern : null;
}

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

export function validateTransitionSuggestions(
  candidates: JsonValue | undefined,
): TransitionSuggestion[] | null {
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
