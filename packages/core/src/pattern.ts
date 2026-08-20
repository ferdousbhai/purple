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
  return `${slug || "riff-pattern"}.strudel`;
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
