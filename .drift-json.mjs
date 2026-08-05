import { Pool } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { diffMigratedSchema } from './scripts/lib/migration-schema-diff.mjs';
const snap = JSON.parse(readFileSync('drizzle/meta/0013_snapshot.json', 'utf8'));
const pool = new Pool({ connectionString: process.argv[2] });
const { rows } = await pool.query(
  "select table_name, column_name from information_schema.columns where table_schema='public'",
);
await pool.end();
const diff = diffMigratedSchema(snap, rows);
writeFileSync(process.argv[3], JSON.stringify(diff, null, 2));
console.log(diff.missingTables.length, 'tables', diff.missingColumns.length, 'columns');
