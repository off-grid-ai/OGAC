// Shared helper for the *.integration.test.ts suites: probe whether a real Postgres is reachable at
// the SAME connection string the app uses (DATABASE_URL, else the src/db default), so the suites run
// for real when `cd deploy && make data` is up and skip gracefully (green) in a DB-less env.
import { Pool } from 'pg';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://offgrid@localhost:5432/offgrid_console';

export async function dbReachable() {
  const pool = new Pool({ connectionString: CONNECTION_STRING, connectionTimeoutMillis: 2000 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

export const SKIP_MESSAGE =
  `Postgres not reachable at ${CONNECTION_STRING} — skipping integration test. ` +
  'Bring it up with `cd deploy && make data` (or set DATABASE_URL) to run it for real.';

/**
 * The same probe, memoised, for suites that must not use TOP-LEVEL await.
 *
 * The suites originally did `const dbUp = await dbReachable()` at module scope so the value could be
 * passed to node:test's `skip` option, which is read at REGISTRATION time. That is a top-level await,
 * and tsx transforms these files as CJS (package.json has no `"type": "module"`), so esbuild rejected
 * them outright:
 *
 *   ERROR: Top-level await is currently not supported with the "cjs" output format
 *
 * The whole file then failed to load — reported as a failing test with no assertion behind it, which
 * is why these six suites were red in CI while passing nothing and failing nothing. Skipping at RUN
 * time via `t.skip()` keeps the graceful-skip behaviour without the top-level await. Memoised so a
 * suite with several cases probes once rather than opening a pool per test.
 */
let probe;
export function dbUpOnce() {
  probe ??= dbReachable();
  return probe;
}
