import type { TransitionSuggestion } from "./types";

const SUGGESTION_COUNT = 3;

export function parseTransitionSuggestions(
  value: unknown,
): TransitionSuggestion[] | null {
  if (typeof value !== "string") return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      !("suggestions" in parsed) ||
      !Array.isArray(parsed.suggestions) ||
      parsed.suggestions.length !== SUGGESTION_COUNT
    ) {
      return null;
    }

    const suggestions: TransitionSuggestion[] = [];
    for (const candidate of parsed.suggestions) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        Array.isArray(candidate) ||
        Object.keys(candidate).length !== 2 ||
        !("label" in candidate) ||
        !("prompt" in candidate) ||
        typeof candidate.label !== "string" ||
        typeof candidate.prompt !== "string"
      ) {
        return null;
      }

      const label = candidate.label.trim();
      const prompt = candidate.prompt.trim();
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

    if (new Set(suggestions.map(({ label }) => label.toLowerCase())).size !== SUGGESTION_COUNT) {
      return null;
    }
    return suggestions;
  } catch {
    return null;
  }
}
