/**
 * Generation-time validation of model patterns. Strudel plays SILENCE for an
 * unknown sound name instead of raising an error, so a successful evaluation
 * alone cannot prove a pattern will sound right. These helpers audit the
 * events a pattern actually produces against the engine's sound registry; the
 * UI layer supplies the registry lookups, keeping this module dependency-free.
 */

export interface UnknownSound {
  /** The name as the engine would resolve it (bank prefix included). */
  name: string;
  /** Registered names closest to the unknown one, best first. */
  suggestions: readonly string[];
}

export type ValidationProblem =
  | { kind: "evaluation"; error: string }
  | { kind: "empty" }
  | { kind: "unknown-sounds"; sounds: readonly UnknownSound[] };

/**
 * What one event's `value` can hold, as far as the audit cares: mini-notation
 * events carry control objects (whose `s`/`bank` may also be patterned as
 * numbers), while bare numeric patterns carry primitives.
 */
export type AuditableHapValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | {
      readonly s?: number | string | null;
      readonly bank?: number | string | null;
    };

/** The slice of a Strudel hap the sound audit reads. */
export interface AuditableHap {
  readonly value?: AuditableHapValue;
}

/**
 * The sound names a pattern's events reference that the engine cannot
 * resolve. `haps` comes from `pattern.queryArc`; `hasSound` is the engine's
 * own registry lookup, so the audit matches trigger-time behavior exactly
 * (case folding and aliases included).
 */
export function auditHapSounds(
  haps: readonly AuditableHap[],
  hasSound: (name: string) => boolean,
): string[] {
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const hap of haps) {
    const resolved = hapSoundName(hap);
    if (resolved === null || seen.has(resolved)) continue;
    seen.add(resolved);
    if (!hasSound(resolved)) unknown.push(resolved);
  }

  return unknown;
}

/** The sound name one hap would ask the engine for, or null for non-sound events. */
function hapSoundName(hap: AuditableHap): string | null {
  const value = hap.value;
  if (!isControlObject(value)) return null;

  const sound = isName(value.s) ? value.s : null;
  if (sound === null) return null;
  // "square:0:.5" selects sample index and gain; the registry holds "square".
  // "-", "~" and "_" mark muted events the engine skips.
  const base = sound.split(":", 1)[0] ?? "";
  if (base === "" || base === "-" || base === "~" || base === "_") return null;

  const bank = isName(value.bank) ? value.bank : null;
  return bank === null ? base : `${bank}_${base}`;
}

type HapControlObject = Exclude<
  AuditableHapValue,
  number | string | boolean | null | undefined
>;

function isControlObject(
  value: AuditableHapValue,
): value is HapControlObject {
  return typeof value === "object" && value !== null;
}

function isName(
  field: number | string | null | undefined,
): field is string {
  return typeof field === "string";
}

/** Registered names closest to `name`, best first - the did-you-mean list. */
export function closestSoundNames(
  name: string,
  available: readonly string[],
  limit = 3,
): string[] {
  const target = name.toLowerCase();
  const maxDistance = Math.max(2, Math.floor(target.length / 3));

  const ranked: { candidate: string; distance: number }[] = [];
  for (const candidate of available) {
    const distance = editDistance(target, candidate.toLowerCase(), maxDistance);
    if (distance <= maxDistance) ranked.push({ candidate, distance });
  }

  ranked.sort(
    (a, b) =>
      a.distance - b.distance || a.candidate.localeCompare(b.candidate),
  );
  return ranked.slice(0, limit).map((entry) => entry.candidate);
}

/** The hidden chat message asking Gemini to fix a pattern that validated badly. */
export function buildValidationRetryMessage(
  code: string,
  problems: readonly ValidationProblem[],
): string {
  const lines = problems.map((problem) => `- ${describeProblem(problem)}`);
  return `Repair this pattern to resolve these validation problems:
${lines.join("\n")}
Original pattern:
\`\`\`strudel
${code}
\`\`\``;
}

function describeProblem(problem: ValidationProblem): string {
  switch (problem.kind) {
    case "evaluation":
      return `It fails to evaluate: ${problem.error}`;
    case "empty":
      return "It evaluates but produces no events - nothing would play.";
    case "unknown-sounds":
      return `These sound names do not exist, so they play silence: ${problem.sounds
        .map((sound) => describeUnknownSound(sound))
        .join("; ")}`;
  }
}

function describeUnknownSound(sound: UnknownSound): string {
  const suggestion =
    sound.suggestions.length > 0
      ? ` (did you mean ${sound.suggestions.map((name) => `"${name}"`).join(" or ")}?)`
      : "";
  return `"${sound.name}"${suggestion}`;
}

/**
 * Levenshtein distance, capped at `limit + 1`: rows whose minimum already
 * exceeds `limit` stop early, keeping the audit cheap across a large registry.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution =
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const cost = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        substitution,
      );
      current.push(cost);
      rowMinimum = Math.min(rowMinimum, cost);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] ?? limit + 1;
}
