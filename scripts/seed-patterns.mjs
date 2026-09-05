// Prints the SQL that loads SEED_PATTERNS into the shared_patterns table.
// Ids derive from titles, so rerunning is a no-op for rows already present:
//   node scripts/seed-patterns.mjs > seed.sql
//   pnpm --filter @purple/web exec wrangler d1 execute purple-patterns --remote --file=seed.sql
import { createHash } from "node:crypto";
import { SEED_PATTERNS } from "../packages/core/src/seed-patterns.ts";

const MINUTE_MS = 60_000;
const now = Date.now();

function shareId(title) {
  return createHash("sha256").update(title).digest("base64url").slice(0, 12);
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const rows = SEED_PATTERNS.map(({ title, code }, index) => {
  // Array order is gallery order under FRESH: the first entry is the newest.
  const createdAt = now - index * MINUTE_MS;
  return `(${[shareId(title), title, code, createdAt].map(sql).join(", ")})`;
});

process.stdout.write(
  `INSERT OR IGNORE INTO shared_patterns (id, title, code, created_at) VALUES\n${rows.join(",\n")};\n`,
);
