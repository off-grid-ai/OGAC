import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const migration = readFileSync(
  new URL('../drizzle/0010_solution_blueprint_contracts.sql', import.meta.url),
  'utf8',
);
const dbUp = await dbReachable();

function schemaName(label: string): string {
  return `solution_migration_${label}_${process.pid}_${Date.now()}`;
}

async function withSchema(
  label: string,
  fn: (client: PoolClient, schema: string) => Promise<void>,
): Promise<void> {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://offgrid@localhost:5432/offgrid_console',
    connectionTimeoutMillis: 10_000,
  });
  const client = await pool.connect();
  const schema = schemaName(label);
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await fn(client, schema);
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
}

async function createAppsBoundary(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE apps (
    id text PRIMARY KEY,
    org_id text NOT NULL DEFAULT 'default'
  )`);
}

async function createLegacySchema(client: PoolClient): Promise<void> {
  await createAppsBoundary(client);
  await client.query(`CREATE TABLE solution_blueprints (
    id text PRIMARY KEY,
    org_id text NOT NULL DEFAULT 'default',
    title text NOT NULL,
    summary text NOT NULL,
    industry text NOT NULL,
    process text NOT NULL,
    business_owner text NOT NULL,
    required_data_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
    required_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
    governed_pipeline text NOT NULL,
    source_template_key text NOT NULL,
    outcome jsonb NOT NULL,
    proof jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(
    'CREATE INDEX solution_blueprints_org_idx ON solution_blueprints (org_id)',
  );
  await client.query(`CREATE TABLE solution_blueprint_seed_state (
    org_id text PRIMARY KEY,
    seeded_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE TABLE solution_deployments (
    id text PRIMARY KEY,
    org_id text NOT NULL DEFAULT 'default',
    blueprint_id text NOT NULL,
    app_id text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    evidence_links jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(
    'CREATE INDEX solution_deployments_org_idx ON solution_deployments (org_id)',
  );
  await client.query(
    'CREATE UNIQUE INDEX solution_deployments_binding_idx ON solution_deployments (org_id, blueprint_id, app_id)',
  );
}

test(
  '0010 creates the complete solution schema on a fresh database',
  { skip: dbUp ? false : SKIP_MESSAGE },
  () =>
    withSchema('fresh', async (client) => {
      await createAppsBoundary(client);
      await client.query(migration);
      const columns = await client.query<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'solution_blueprint_seed_state'
        ORDER BY column_name`);
      assert.deepEqual(
        columns.rows.map((row) => row.column_name),
        ['catalog_version', 'org_id', 'seeded_at'],
      );
      const tables = await client.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name LIKE 'solution_%'
        ORDER BY table_name`);
      assert.deepEqual(tables.rows.map((row) => row.table_name), [
        'solution_blueprint_seed_state',
        'solution_blueprint_versions',
        'solution_blueprints',
        'solution_deployments',
        'solution_observations',
      ]);
    }),
);

test(
  '0010 upgrades request-time tables without promoting legacy proof',
  { skip: dbUp ? false : SKIP_MESSAGE },
  () =>
    withSchema('upgrade', async (client) => {
      await createLegacySchema(client);
      await client.query(`INSERT INTO apps (id, org_id) VALUES ('app-1', 'bank')`);
      await client.query(`INSERT INTO solution_blueprint_seed_state (org_id) VALUES ('bank')`);
      await client.query(`INSERT INTO solution_blueprints (
        id, org_id, title, summary, industry, process, business_owner,
        required_data_domains, required_tools, governed_pipeline, source_template_key, outcome, proof
      ) VALUES (
        'bp-1', 'bank', 'Delinquency Intervention', 'legacy', 'Lending', 'Collections', 'Owner',
        '["loan accounts"]', '["human approval"]', 'Legacy pipeline', 'loan-underwriting',
        '{"metricName":"30+ DPD","metricUnit":"%","direction":"decrease","measurementWindow":"30 days","baseline":{"value":12,"label":"before"},"target":{"value":9,"label":"after"},"measured":{"value":8,"label":"claimed"},"roi":{"currency":"USD","annualBenefit":99,"implementationCost":1,"annualOperatingCost":1,"rationale":"legacy"}}',
        '{"status":"verified","summary":"unsupported","evidenceLinks":["/legacy"]}'
      )`);
      await client.query(`INSERT INTO solution_deployments (
        id, org_id, blueprint_id, app_id, status
      ) VALUES ('dep-1', 'bank', 'bp-1', 'app-1', 'active')`);

      await client.query(migration);

      const state = await client.query<{ catalog_version: number }>(
        `SELECT catalog_version FROM solution_blueprint_seed_state WHERE org_id = 'bank'`,
      );
      assert.equal(state.rows[0]?.catalog_version, 1);
      const migrated = await client.query<{
        source_catalog_key: string;
        catalog_version: number;
        snapshot: Record<string, unknown>;
      }>(`SELECT b.source_catalog_key, b.catalog_version, v.snapshot
          FROM solution_blueprints b
          JOIN solution_blueprint_versions v ON v.blueprint_id = b.id AND v.version = 1
          WHERE b.id = 'bp-1'`);
      assert.equal(migrated.rows[0]?.source_catalog_key, 'lending-delinquency-intervention');
      assert.equal(migrated.rows[0]?.catalog_version, 1);
      const snapshot = migrated.rows[0]?.snapshot as {
        adoptable?: boolean;
        outcome?: { measured?: unknown };
        proof?: { status?: string; evidenceLinks?: unknown[] };
      };
      assert.equal(snapshot.adoptable, false);
      assert.equal(snapshot.outcome?.measured, null);
      assert.equal(snapshot.proof?.status, 'unverified');
      assert.deepEqual(snapshot.proof?.evidenceLinks, []);
      const deployment = await client.query<{ status: string; pipeline_id: string }>(
        `SELECT status, pipeline_id FROM solution_deployments WHERE id = 'dep-1'`,
      );
      assert.deepEqual(deployment.rows[0], {
        status: 'retired',
        pipeline_id: 'legacy:unverified',
      });
    }),
);

test(
  '0010 rolls every rename back when a later migration statement fails',
  { skip: dbUp ? false : SKIP_MESSAGE },
  () =>
    withSchema('rollback', async (client, schema) => {
      await createLegacySchema(client);
      await client.query('BEGIN');
      try {
        // Force the new Blueprint creation to fail after the migration has renamed the legacy table.
        await client.query(`CREATE VIEW solution_blueprint_versions AS SELECT 1 AS version`);
        await assert.rejects(client.query(migration));
      } finally {
        await client.query('ROLLBACK');
      }
      const names = await client.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = '${schema}' AND table_name IN ('solution_blueprints', 'solution_blueprints_legacy')
        ORDER BY table_name`);
      assert.deepEqual(names.rows.map((row) => row.table_name), ['solution_blueprints']);
    }),
);
