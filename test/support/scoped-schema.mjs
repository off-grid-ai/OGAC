// A throwaway Postgres schema for one integration test.
//
// For the SELF-MIGRATING stores (`CREATE TABLE IF NOT EXISTS` on first use) there is no migration
// file to load — the store builds its own tables, and that build is part of what the test must
// exercise. So this helper only carves out an isolated search_path and hands back the scoped URL;
// what goes in it is the store's business.
//
// Isolated per test run so a suite can never read another suite's rows, and dropped on cleanup so a
// developer's database does not fill up with debris from every test run.
import { Pool } from 'pg';

const DEFAULT_DATABASE_URL = 'postgresql://offgrid@localhost:5432/offgrid_console';

export async function prepareScopedSchema(label) {
  const baseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const schema = `t_${label}_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const pool = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 10_000 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await pool.end();
  }
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return {
    schema,
    databaseUrl: url.toString(),
    async cleanup() {
      const p = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 10_000 });
      try {
        await p.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await p.end();
      }
    },
  };
}
