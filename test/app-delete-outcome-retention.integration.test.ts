import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Pool } from 'pg';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { prepareActionOutcomeSchema } from './support/action-outcome-schema.mjs';

const dbUp = await dbReachable();
const previous = {
  databaseUrl: process.env.DATABASE_URL,
  org: process.env.OFFGRID_ORG,
  token: process.env.OFFGRID_ADMIN_TOKEN,
  authSecret: process.env.AUTH_SECRET,
};
const prepared = dbUp ? await prepareActionOutcomeSchema('app_delete') : null;
if (prepared) process.env.DATABASE_URL = prepared.databaseUrl;
process.env.OFFGRID_ORG = 'org_retained';
process.env.OFFGRID_ADMIN_TOKEN = 'outcome-delete-test';
process.env.AUTH_SECRET = 'outcome-delete-test-secret-outcome-delete-test-secret';

after(async () => {
  await prepared?.cleanup();
  restore('DATABASE_URL', previous.databaseUrl);
  restore('OFFGRID_ORG', previous.org);
  restore('OFFGRID_ADMIN_TOKEN', previous.token);
  restore('AUTH_SECRET', previous.authSecret);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test(
  'App deletion returns an explicit retained-evidence conflict instead of a database error',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const pool = new Pool({ connectionString: prepared!.databaseUrl });
    await pool.query(
      `INSERT INTO apps (id, org_id, owner_id)
       VALUES ('app_retained', 'org_retained', 'retention-test')`,
    );
    await pool.query(
      `INSERT INTO app_runs (id, org_id, app_id) VALUES ('run_retained', 'org_retained', 'app_retained')`,
    );
    await pool.query(`
      INSERT INTO action_outcome_observations (
        id, org_id, app_id, run_id, step_id, receipt_idempotency_key, action_id,
        action_target, action_executed_at, action_receipt, kind, outcome_code, observed_at,
        source_kind, source_event_id, source_idempotency_key, note, evidence_links, recorded_by
      ) VALUES (
        'out_retained', 'org_retained', 'app_retained', 'run_retained', 'action_step',
        'receipt_retained', 'crm.create-task', 'opp_1', now() - interval '1 minute',
        '{}'::jsonb, 'observed', 'converted', now(), 'system', 'conversion_1',
        'source_retained', 'Conversion retained for audit.', '["/evidence"]'::jsonb, 'crm-service'
      )`);

    const { DELETE } = await import('../src/app/api/v1/admin/apps/[id]/route.ts');
    const response = await DELETE(
      new Request('http://console.local/api/v1/admin/apps/app_retained', {
        method: 'DELETE',
        headers: { authorization: 'Bearer outcome-delete-test' },
      }),
      { params: Promise.resolve({ id: 'app_retained' }) },
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'This App has retained business-result evidence and cannot be deleted',
      code: 'referenced',
      action: 'keep the App so its audit history remains available',
    });
    const retained = await pool.query(`SELECT id FROM apps WHERE id = 'app_retained'`);
    assert.equal(retained.rowCount, 1);
    await pool.end();
  },
);
