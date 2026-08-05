#!/usr/bin/env node
//
// Gate: a database built from `drizzle/*.sql` ALONE must match src/db/schema.ts.
//
// Thin I/O adapter over scripts/lib/migration-schema-diff.mjs (the pure diff). Reads the newest
// drizzle snapshot (the machine record of schema.ts) and information_schema from the live DB.
//
// Usage: DATABASE_URL=... node scripts/verify-migration-schema.mjs
// Run it in CI right after `drizzle-kit migrate`, so a future migration that forgets a column fails
// there instead of surfacing as a `column ... does not exist` integration-test failure.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  diffMigratedSchema,
  formatSchemaDiff,
  isMigrationSchemaComplete,
} from './lib/migration-schema-diff.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metaDir = join(repositoryRoot, 'drizzle', 'meta');

async function latestSnapshot() {
  const journal = JSON.parse(await readFile(join(metaDir, '_journal.json'), 'utf8'));
  const last = journal.entries.at(-1);
  if (!last) throw new Error('drizzle/meta/_journal.json has no entries.');
  const padded = String(last.idx).padStart(4, '0');
  return JSON.parse(await readFile(join(metaDir, `${padded}_snapshot.json`), 'utf8'));
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://offgrid@localhost:5432/offgrid_console';

const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
try {
  const snapshot = await latestSnapshot();
  const { rows } = await pool.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  );
  const diff = diffMigratedSchema(snapshot, rows);
  console.log(formatSchemaDiff(diff));
  if (!isMigrationSchemaComplete(diff)) process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
