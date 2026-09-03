/** Patterns larger than this are rejected rather than landed in the editor. */
export const MAX_PATTERN_LENGTH = 30_000;

export function validatePatternCode(value: string): string | null {
  const pattern = value.trim();
  return pattern && pattern.length <= MAX_PATTERN_LENGTH ? pattern : null;
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

export function validatePatternTitle(value: string): string | null {
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

