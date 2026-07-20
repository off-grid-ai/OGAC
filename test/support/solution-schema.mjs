import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const DEFAULT_DATABASE_URL = 'postgresql://offgrid@localhost:5432/offgrid_console';

function scopedDatabaseUrl(base, schema) {
  const url = new URL(base);
  url.searchParams.set('options', `-csearch_path=${schema},public`);
  return url.toString();
}

/**
 * Install migration 0010 in a disposable schema while cloning its mutable App/Pipeline boundaries
 * and resolving the remaining pre-existing Console tables from public. This makes the real
 * store/API tests executable on a developer database that has not applied 0010 globally, without
 * mutating its production schema or leaking test Apps/Pipelines into it.
 */
export async function prepareSolutionSchema(label) {
  const baseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const schema = `solution_${label}_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/g, '_');
  const pool = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    const migration = await readFile(
      new URL('../../drizzle/0010_solution_blueprint_contracts.sql', import.meta.url),
      'utf8',
    );
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    // The stores self-provision in the first search_path schema. Clone both mutable boundaries
    // before 0010 creates its FK so Apps, Pipelines, and solution_deployments share one real graph.
    // PostgreSQL LIKE INCLUDING ALL deliberately does not copy foreign keys, so restore the
    // production App→Pipeline invariant explicitly instead of leaving the fixture less strict.
    await client.query('CREATE TABLE pipelines (LIKE public.pipelines INCLUDING ALL)');
    await client.query('CREATE TABLE apps (LIKE public.apps INCLUDING ALL)');
    await client.query(`ALTER TABLE apps ADD CONSTRAINT apps_pipeline_org_fk
      FOREIGN KEY (pipeline_id, org_id) REFERENCES pipelines (id, org_id)
      ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE`);
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
