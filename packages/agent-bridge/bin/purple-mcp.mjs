#!/usr/bin/env node
// Runs the TypeScript sources directly; Node 22.18+ strips types natively.
const entry = new URL("../src/main.ts", import.meta.url);
import(entry.href)
  .then((module) => module.main())
  .catch((error) => {
    console.error(`[purple-mcp] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
