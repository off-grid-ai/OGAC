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
      'action_outcome_observations_lifecycle_check',
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

    await pool.query(
      `INSERT INTO apps (id, org_id, owner_id)
       VALUES ('app_constraints', 'org_constraints', 'migration-test')`,
    );
    await pool.query(
      `INSERT INTO app_runs (id, org_id, app_id) VALUES ('run_constraints', 'org_constraints', 'app_constraints')`,
    );
    const insert = (
      id: string,
      kind: string,
      outcomeCode: string | null,
      supersedesId: string | null,
      measurement: Record<string, unknown> | null = null,
    ) =>
      pool.query(
        `INSERT INTO action_outcome_observations (
          id, org_id, app_id, run_id, step_id, receipt_idempotency_key, action_id,
          action_target, action_executed_at, action_receipt, kind, outcome_code, observed_at,
          source_kind, source_event_id, source_idempotency_key, note, evidence_links,
          measurement, supersedes_id, recorded_by
        ) VALUES (
          $1, 'org_constraints', 'app_constraints', 'run_constraints', 'action_step',
          'receipt_constraints', 'crm.create-task', 'opp_1', now() - interval '1 minute',
          '{}'::jsonb, $2, $3, now(), 'system', $1, 'source_' || $1,
          'constraint proof', '["/evidence"]'::jsonb, $4::jsonb, $5, 'migration-test'
        )`,
        [id, kind, outcomeCode, measurement ? JSON.stringify(measurement) : null, supersedesId],
      );

    await insert('valid_observation', 'observed', 'accepted', null);
    await assert.rejects(
      insert('bad_correction', 'corrected', 'rejected', null),
      /action_outcome_observations_lifecycle_check/,
    );
    await assert.rejects(
      insert('bad_observed_supersession', 'observed', 'accepted', 'valid_observation'),
      /action_outcome_observations_lifecycle_check/,
    );
    await assert.rejects(
      insert('bad_withdrawal_measurement', 'withdrawn', null, 'valid_observation', {
        metricName: 'Revenue',
        metricUnit: 'INR',
        resultValue: 1,
      }),
      /action_outcome_observations_lifecycle_check/,
    );
    await pool.end();
  },
);
