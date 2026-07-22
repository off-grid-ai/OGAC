import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Pool } from 'pg';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { prepareActionOutcomeSchema } from './support/action-outcome-schema.mjs';

const dbUp = await dbReachable();
const prepared = dbUp ? await prepareActionOutcomeSchema('migration') : null;
after(() => prepared?.cleanup());

test(
  '0012 installs the atomic evidence constraints, foreign keys and canonical indexes',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const pool = new Pool({ connectionString: prepared!.databaseUrl });
    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'action_outcome_observations'
      ORDER BY column_name`);
    assert.ok(columns.rows.some((row) => row.column_name === 'action_receipt'));
    assert.ok(columns.rows.some((row) => row.column_name === 'source_idempotency_key'));
    assert.ok(!columns.rows.some((row) => row.column_name === 'deployment_id'));
    assert.ok(!columns.rows.some((row) => row.column_name === 'observation_key'));

    const constraints = await pool.query<{ constraint_name: string }>(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema = current_schema() AND table_name = 'action_outcome_observations'
      ORDER BY constraint_name`);
    const names = constraints.rows.map((row) => row.constraint_name);
    for (const required of [
      'action_outcome_observations_app_fk',
      'action_outcome_observations_evidence_check',
      'action_outcome_observations_kind_check',
      'action_outcome_observations_outcome_check',
      'action_outcome_observations_run_fk',
      'action_outcome_observations_source_check',
      'action_outcome_observations_supersedes_fk',
      'action_outcome_observations_time_check',
    ]) {
      assert.ok(names.includes(required), `missing ${required}`);
    }

    const indexes = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'action_outcome_observations'`);
    const indexNames = indexes.rows.map((row) => row.indexname);
    for (const required of [
      'action_outcome_observations_source_idempotency_idx',
      'action_outcome_observations_supersedes_idx',
      'action_outcome_observations_run_step_idx',
      'action_outcome_observations_app_time_idx',
      'action_outcome_observations_receipt_time_idx',
    ]) {
      assert.ok(indexNames.includes(required), `missing ${required}`);
    }
    await pool.end();
  },
);
