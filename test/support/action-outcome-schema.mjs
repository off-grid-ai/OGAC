import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const DEFAULT_DATABASE_URL = 'postgresql://offgrid@localhost:5432/offgrid_console';

function scopedDatabaseUrl(base, schema) {
  const url = new URL(base);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}

export async function prepareActionOutcomeSchema(label) {
  const baseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const schema = `action_outcome_${label}_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/g, '_');
  const pool = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    const migration = await readFile(
      new URL('../../drizzle/0012_action_outcome_observations.sql', import.meta.url),
      'utf8',
    );
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE apps (
      id text PRIMARY KEY,
      org_id text NOT NULL,
      owner_id text NOT NULL
    )`);
    await client.query(`CREATE TABLE app_runs (
      id text PRIMARY KEY,
      org_id text NOT NULL,
      app_id text NOT NULL,
      status text NOT NULL DEFAULT 'done',
      trigger jsonb NOT NULL DEFAULT '{"kind":"on-demand"}'::jsonb,
      input jsonb NOT NULL DEFAULT '{}'::jsonb,
      steps jsonb NOT NULL DEFAULT '[]'::jsonb,
      outcome text NOT NULL DEFAULT '',
      provenance jsonb,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )`);
    await client.query(migration);
  } catch (error) {
    await client.query('SET search_path TO public').catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  return {
    schema,
    databaseUrl: scopedDatabaseUrl(baseUrl, schema),
    async cleanup() {
      const cleanupPool = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 10_000 });
      try {
        await cleanupPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await cleanupPool.end();
      }
    },
  };
}
