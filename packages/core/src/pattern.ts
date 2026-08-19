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

export function validateGeneratedPatternTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
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
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      !("title" in parsed)
    ) {
      return null;
    }
    return validateGeneratedPatternTitle(parsed.title);
  } catch {
    return null;
  }
}

/** Parse the raw JSON response produced under the transition-suggestions schema. */
export function parseTransitionSuggestions(
  value: string,
): TransitionSuggestion[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      !("suggestions" in parsed) ||
      !Array.isArray(parsed.suggestions) ||
      parsed.suggestions.length !== 3
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

    return new Set(suggestions.map(({ label }) => label.toLowerCase())).size ===
      3
      ? suggestions
      : null;
  } catch {
    return null;
  }
}
