/**
 * Every value `JSON.parse` can produce. Untrusted JSON is decoded into this
 * shape once, at the I/O boundary, so the parsers branch on JSON values
 * instead of re-probing raw representations.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

type JsonObject = { readonly [key: string]: JsonValue };

/**
 * The members of a JSON object, or null for every other JSON value. `JSON.parse`
 * builds objects - and only objects - directly from `Object.prototype`.
 */
export function jsonMembers(
  value: JsonValue,
): ReadonlyMap<string, JsonValue> | null {
  if (value === null || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  return new Map(Object.entries(value));
}

export function jsonText(value: JsonValue | undefined): string | null {
  return isJsonString(value) ? value : null;
}

export function isJsonString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

export function isJsonNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseJsonMembers(
  response: string,
): ReadonlyMap<string, JsonValue> | null {
  try {
    const parsed: JsonValue = JSON.parse(response);
    return jsonMembers(parsed);
  } catch {
    return null;
  }
}
