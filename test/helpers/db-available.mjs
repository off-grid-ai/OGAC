// Shared DB-reachability probe for the integration tests. If DATABASE_URL is unset we fall back to
// the SAME default `src/db/index.ts` uses, so a local `cd deploy && make data` stack is picked up
// automatically. Returns { ok, reason } — tests use it to `skip` gracefully when Postgres is down,
// keeping `npm test` green DB-less while running for real when the DB is up.
import { Pool } from 'pg';

const DEFAULT_URL = 'postgresql://offgrid@localhost:5432/offgrid_console';

export function dbUrl() {
  return process.env.DATABASE_URL ?? DEFAULT_URL;
}

export async function dbAvailable() {
  const pool = new Pool({ connectionString: dbUrl(), connectionTimeoutMillis: 2000 });
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (e) {
    const code = e?.code ?? e?.cause?.code ?? e?.message;
    return { ok: false, reason: `Postgres unreachable (${code}) at ${dbUrl()} — run \`cd deploy && make data\`` };
  } finally {
    await pool.end().catch(() => {});
  }
}
