/* eslint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion */
// Remote JSON starts unknown by definition; the parsers below establish the
// complete manifest contract before any value reaches Strudel.
type SampleLeaf = string | readonly string[];
type SampleMap = Record<string, SampleLeaf | Record<string, SampleLeaf>>;
type BankAliases = Record<string, string | readonly string[]>;

const DIRT_SAMPLES_COMMIT = "c74fc80f8db8038f6a33648ffef5ac00a07ad402";
const DOUGH_SAMPLES_COMMIT = "9eacfc86ec4393e68a463ff52b01c19cfaa77f38";
const DRUM_MACHINES_COMMIT = "15eac73c5e878550f91d864a4863e014799403f1";
const BANK_ALIASES_COMMIT = "f58b317308194e9a8523a4ccd687684375f72da5";

const RAW_GITHUB = "https://raw.githubusercontent.com";
const MAX_MANIFEST_BYTES = 512_000;
const MANIFEST_TIMEOUT_MS = 8_000;
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

interface SampleLoader {
  samples(source: SampleMap, baseUrl: string): Promise<void>;
  aliasBank(aliases: BankAliases): Promise<void>;
}

/** Load immutable, data-only sample manifests. Audio remains lazy and is also
 * fetched from commit-addressed URLs, so an upstream branch change cannot
 * replace content inside a released Purple build. */
export async function loadPinnedSamples(strudel: SampleLoader): Promise<void> {
  const dirtManifest = `${RAW_GITHUB}/tidalcycles/Dirt-Samples/${DIRT_SAMPLES_COMMIT}/strudel.json`;
  const doughRoot = `${RAW_GITHUB}/felixroos/dough-samples/${DOUGH_SAMPLES_COMMIT}`;
  const aliasManifest = `${RAW_GITHUB}/todepond/samples/${BANK_ALIASES_COMMIT}/tidal-drum-machines-alias.json`;

  const [dirt, machines, piano, aliases] = await Promise.all([
    fetchJson(dirtManifest).then(parseSampleMap),
    fetchJson(`${doughRoot}/tidal-drum-machines.json`).then(parseSampleMap),
    fetchJson(`${doughRoot}/piano.json`).then(parseSampleMap),
    fetchJson(aliasManifest).then(parseAliases),
  ]);

  await Promise.all([
    strudel.samples(
      dirt,
      `${RAW_GITHUB}/tidalcycles/Dirt-Samples/${DIRT_SAMPLES_COMMIT}/`,
    ),
    strudel.samples(
      machines,
      `${RAW_GITHUB}/ritchse/tidal-drum-machines/${DRUM_MACHINES_COMMIT}/machines/`,
    ),
    strudel.samples(piano, `${doughRoot}/piano/`),
  ]);
  await strudel.aliasBank(aliases);
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MANIFEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Could not load pinned sample manifest (${response.status}).`);
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_MANIFEST_BYTES) {
      throw new Error("Pinned sample manifest exceeds the size limit.");
    }
    const text = await response.text();
    if (text.length > MAX_MANIFEST_BYTES) {
      throw new Error("Pinned sample manifest exceeds the size limit.");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Pinned sample manifest is not valid JSON.");
    }
  } catch (error) {
    if (timedOut) {
      throw new Error("Pinned sample manifests took too long to load.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSampleMap(input: unknown): SampleMap {
  const object = plainObject(input, "sample manifest");
  const result: SampleMap = Object.create(null) as SampleMap;
  for (const [name, value] of Object.entries(object)) {
    // Upstream manifests carry mutable branch bases. Purple supplies its own
    // commit-addressed base and never trusts this field.
    if (name === "_base") continue;
    assertName(name, "sample");
    result[name] = parseSampleValue(value);
  }
  if (Object.keys(result).length === 0) {
    throw new Error("Pinned sample manifest is empty.");
  }
  return result;
}

function parseSampleValue(
  input: unknown,
): SampleLeaf | Record<string, SampleLeaf> {
  if (typeof input === "string") return safePath(input);
  if (Array.isArray(input)) return input.map((item) => safePath(item));

  const object = plainObject(input, "pitched sample map");
  const result: Record<string, SampleLeaf> = Object.create(null) as Record<
    string,
    SampleLeaf
  >;
  for (const [note, value] of Object.entries(object)) {
    assertName(note, "sample note");
    if (typeof value === "string") result[note] = safePath(value);
    else if (Array.isArray(value)) {
      result[note] = value.map((item) => safePath(item));
    } else {
      throw new Error("Pinned sample manifest has an invalid pitched sample.");
    }
  }
  return result;
}

function parseAliases(input: unknown): BankAliases {
  const object = plainObject(input, "bank alias manifest");
  const result: BankAliases = Object.create(null) as BankAliases;
  for (const [bank, value] of Object.entries(object)) {
    assertName(bank, "bank");
    if (typeof value === "string") {
      assertName(value, "bank alias");
      result[bank] = value;
    } else if (Array.isArray(value)) {
      result[bank] = value.map((alias) => {
        if (typeof alias !== "string") {
          throw new Error("Pinned bank alias manifest has an invalid alias.");
        }
        assertName(alias, "bank alias");
        return alias;
      });
    } else {
      throw new Error("Pinned bank alias manifest has an invalid alias.");
    }
  }
  return result;
}

function safePath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 500) {
    throw new Error("Pinned sample manifest has an invalid path.");
  }
  const segments = input.split("/");
  if (
    input.startsWith("/") ||
    input.includes("\\") ||
    input.includes("://") ||
    segments.some((segment) => segment === "." || segment === "..") ||
    [...input].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error("Pinned sample manifest contains an unsafe path.");
  }
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function plainObject(
  input: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Pinned ${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Pinned ${label} has an invalid prototype.`);
  }
  return input as Record<string, unknown>;
}

function assertName(value: string, label: string): void {
  if (
    !SAFE_NAME.test(value) ||
    ["_base", "__proto__", "constructor", "prototype"].includes(value)
  ) {
    throw new Error(`Pinned ${label} name is invalid.`);
  }
}
