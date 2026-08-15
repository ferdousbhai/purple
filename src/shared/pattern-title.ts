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

export function parseGeneratedPatternTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;

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
