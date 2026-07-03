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
