// PURE diff between "what src/db/schema.ts declares" and "what a database actually has".
//
// WHY it exists: the drizzle migrations had silently drifted from src/db/schema.ts (3 tables, 18
// columns lived only in the stores' cold-start ensure*Schema() DDL), which is what kept Postgres out
// of CI — the *.integration.test.ts suites hard-failed on `column ... does not exist` instead of
// running. drizzle-kit itself cannot catch that: `generate` diffs schema.ts against its own snapshot,
// never against a database built from the migrations. This module closes that loop.
//
// Zero I/O so it is unit-testable: callers pass the drizzle snapshot JSON and the rows of
// information_schema.columns. See scripts/verify-migration-schema.mjs for the adapter.

/**
 * Tables drizzle creates for its own bookkeeping — present in a migrated DB, absent from schema.ts.
 * Not drift.
 */
export const BOOKKEEPING_TABLES = new Set(['__drizzle_migrations']);

/**
 * @param {{ tables: Record<string, { name: string, columns: Record<string, unknown> }> }} snapshot
 *   A drizzle meta/*_snapshot.json — the machine record of src/db/schema.ts.
 * @param {Array<{ table_name: string, column_name: string }>} liveColumns
 *   Rows of `select table_name, column_name from information_schema.columns where table_schema='public'`.
 * @returns {{ missingTables: string[], missingColumns: string[], extraTables: string[], declaredTables: number }}
 */
export function diffMigratedSchema(snapshot, liveColumns) {
  const live = new Map();
  for (const row of liveColumns) {
    if (!live.has(row.table_name)) live.set(row.table_name, new Set());
    live.get(row.table_name).add(row.column_name);
  }

  const declared = new Map();
  for (const table of Object.values(snapshot.tables ?? {})) {
    declared.set(table.name, new Set(Object.keys(table.columns ?? {})));
  }

  const missingTables = [];
  const missingColumns = [];
  for (const [table, columns] of declared) {
    const liveTable = live.get(table);
    if (!liveTable) {
      missingTables.push(table);
      continue;
    }
    for (const column of columns) {
      if (!liveTable.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }

  // An EXTRA table is reported but is not itself a failure: a table can legitimately outlive its
  // schema.ts declaration (retired feature, still-populated audit table) and dropping it would be
  // destructive. It is drift worth SEEING, not drift worth failing a build over.
  const extraTables = [...live.keys()].filter(
    (table) => !declared.has(table) && !BOOKKEEPING_TABLES.has(table),
  );

  return {
    missingTables: missingTables.sort(),
    missingColumns: missingColumns.sort(),
    extraTables: extraTables.sort(),
    declaredTables: declared.size,
  };
}

/**
 * A migrated database is ACCEPTABLE when nothing src/db/schema.ts declares is absent from it.
 * @param {ReturnType<typeof diffMigratedSchema>} diff
 */
export function isMigrationSchemaComplete(diff) {
  return diff.missingTables.length === 0 && diff.missingColumns.length === 0;
}

/** Human-readable report for the CI log. @param {ReturnType<typeof diffMigratedSchema>} diff */
export function formatSchemaDiff(diff) {
  const lines = [];
  for (const table of diff.missingTables) lines.push(`MISSING TABLE   ${table}`);
  for (const column of diff.missingColumns) lines.push(`MISSING COLUMN  ${column}`);
  for (const table of diff.extraTables) lines.push(`extra table     ${table} (not in schema.ts — advisory)`);
  lines.push(
    isMigrationSchemaComplete(diff)
      ? `OK — all ${diff.declaredTables} tables declared in src/db/schema.ts exist in the migrated database, with every column.`
      : `DRIFT — ${diff.missingTables.length} missing table(s), ${diff.missingColumns.length} missing column(s). ` +
          'Run `npx drizzle-kit generate` and commit the migration.',
  );
  return lines.join('\n');
}
