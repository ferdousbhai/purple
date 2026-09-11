/** Patterns larger than this are rejected rather than landed in the editor. */
export const MAX_PATTERN_LENGTH = 30_000;

/** A title the editor accepts has to survive sharing, so both paths use this. */
export const MAX_TITLE_LENGTH = 60;

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
    title.length > MAX_TITLE_LENGTH ||
    title.includes("\n") ||
    title.includes("```") ||
    /^["'“”]|["'“”]$/.test(title)
  ) {
    return null;
  }
  return title;
}

