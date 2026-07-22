import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Pool } from 'pg';
import type { ActionReceipt } from '@/lib/action-contract';
import type { ActionOutcomeMutationInput } from '@/lib/action-outcome-contract';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { prepareActionOutcomeSchema } from './support/action-outcome-schema.mjs';

const dbUp = await dbReachable();
const previousDatabaseUrl = process.env.DATABASE_URL;
const prepared = dbUp ? await prepareActionOutcomeSchema('store') : null;
if (prepared) process.env.DATABASE_URL = prepared.databaseUrl;
after(async () => {
  await prepared?.cleanup();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

test(
  'retains tenant-scoped receipt outcomes, retries, correction history and withdrawal history',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const store = await import('@/lib/action-outcome-observation-store');
    const pool = new Pool({ connectionString: prepared!.databaseUrl });
    const executedAt = new Date(Date.now() - 60_000).toISOString();
    const observedAt = new Date(Date.now() - 30_000).toISOString();
    const receipt: ActionReceipt = {
      actionId: 'crm.create-task',
      label: 'Create CRM follow-up task',
      system: 'CRM',
      orgId: 'org_bharat',
      runId: 'run_cross_sell',
      stepId: 'act',
      connectorId: 'crm_bharat',
      target: 'opp_101',
      idempotencyKey: 'action:cross-sell-101',
      status: 'executed',
      executedAt,
      approval: { stepId: 'review', evidence: 'RM approved', reviewer: 'rm@bank.local' },
      providerReceipt: { signature: 'signed-provider-receipt' },
    };
    await pool.query(`INSERT INTO apps (id, org_id) VALUES ($1, $2)`, [
      'app_cross_sell',
      'org_bharat',
    ]);
    await pool.query(
      `INSERT INTO app_runs (id, org_id, app_id, steps, finished_at)
       VALUES ($1, $2, $3, $4::jsonb, now())`,
      [
        receipt.runId,
        receipt.orgId,
        'app_cross_sell',
        JSON.stringify([
          { id: 'review', kind: 'human', label: 'RM review', status: 'done' },
          { id: 'act', kind: 'action', label: 'Create follow-up', status: 'done', actionReceipt: receipt },
        ]),
      ],
    );

    const accepted: ActionOutcomeMutationInput = {
      runId: receipt.runId,
      stepId: receipt.stepId,
      kind: 'observed',
      outcomeCode: 'accepted',
      observedAt,
      source: { kind: 'human', eventId: 'customer-response-accepted' },
      note: 'Customer accepted the offer.',
      evidenceLinks: ['/crm/opportunities/opp_101'],
    };
    const first = await store.recordActionOutcome(accepted, receipt.orgId, 'rm@bank.local');
    assert.equal(first.replayed, false);
    assert.equal(first.observation.appId, 'app_cross_sell');
    assert.deepEqual(first.observation.actionReceipt, receipt);
    assert.equal(first.observation.source.idempotencyKey.length, 64);

    const replay = await store.recordActionOutcome(
      { ...accepted, evidenceLinks: [...accepted.evidenceLinks].reverse() },
      receipt.orgId,
      'rm@bank.local',
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.observation.id, first.observation.id);

    await assert.rejects(
      store.recordActionOutcome(
        { ...accepted, outcomeCode: 'rejected' },
        receipt.orgId,
        'rm@bank.local',
      ),
      store.ActionOutcomeConflictError,
    );
    await assert.rejects(
      store.recordActionOutcome(accepted, 'org_other', 'intruder@other.local'),
      store.ActionOutcomeNotFoundError,
    );
    await assert.rejects(
      store.recordActionOutcome({ ...accepted, stepId: 'missing' }, receipt.orgId, 'rm@bank.local'),
      store.ActionOutcomeNotFoundError,
    );

    const converted = await store.recordActionOutcome(
      {
        ...accepted,
        outcomeCode: 'converted',
        source: { kind: 'system', eventId: 'crm-conversion-101' },
        note: 'CRM marked the opportunity converted.',
      },
      receipt.orgId,
      'crm-service',
    );
    const corrected = await store.recordActionOutcome(
      {
        ...accepted,
        kind: 'corrected',
        outcomeCode: 'rejected',
        source: { kind: 'human', eventId: 'customer-response-correction' },
        note: 'RM corrected the original response.',
        supersedesId: first.observation.id,
      },
      receipt.orgId,
      'rm@bank.local',
    );
    assert.equal(corrected.observation.supersedesId, first.observation.id);
    await assert.rejects(
      store.recordActionOutcome(
        {
          ...accepted,
          kind: 'withdrawn',
          outcomeCode: undefined,
          source: { kind: 'human', eventId: 'duplicate-supersession' },
          note: 'Attempt to withdraw an already corrected fact.',
          supersedesId: first.observation.id,
        },
        receipt.orgId,
        'rm@bank.local',
      ),
      store.ActionOutcomeConflictError,
    );
    const withdrawn = await store.recordActionOutcome(
      {
        ...accepted,
        kind: 'withdrawn',
        outcomeCode: undefined,
        source: { kind: 'system', eventId: 'conversion-withdrawal' },
        note: 'CRM reversed the conversion.',
        supersedesId: converted.observation.id,
      },
      receipt.orgId,
      'crm-service',
    );
    assert.equal(withdrawn.observation.outcomeCode, null);

    const listed = await store.listActionOutcomes(receipt.runId, receipt.stepId, receipt.orgId);
    assert.deepEqual(
      listed.map((row) => row.kind),
      ['observed', 'observed', 'corrected', 'withdrawn'],
    );
    assert.equal(
      (await store.getActionOutcome(first.observation.id, receipt.runId, receipt.stepId, receipt.orgId))
        ?.id,
      first.observation.id,
    );
    assert.equal(
      await store.getActionOutcome(first.observation.id, receipt.runId, receipt.stepId, 'org_other'),
      null,
    );
    assert.deepEqual(await store.listActionOutcomes(receipt.runId, receipt.stepId, 'org_other'), []);

    const pending = await store.recordActionOutcome(
      {
        ...accepted,
        outcomeCode: 'settled',
        source: { kind: 'import', eventId: 'settlement-import' },
        note: 'Imported settlement result.',
      },
      receipt.orgId,
      'import-service',
    );
    const correctionInput = (eventId: string): ActionOutcomeMutationInput => ({
      ...accepted,
      kind: 'corrected',
      outcomeCode: 'cured',
      source: { kind: 'import', eventId },
      note: 'Correct imported settlement result.',
      supersedesId: pending.observation.id,
    });
    const corrections = await Promise.allSettled([
      store.recordActionOutcome(correctionInput('correction-race-1'), receipt.orgId, 'import-service'),
      store.recordActionOutcome(correctionInput('correction-race-2'), receipt.orgId, 'import-service'),
    ]);
    assert.equal(corrections.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(corrections.filter((result) => result.status === 'rejected').length, 1);

    await pool.end();
  },
);

test(
  'rejects outcome timestamps outside the canonical receipt window',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const store = await import('@/lib/action-outcome-observation-store');
    const base: ActionOutcomeMutationInput = {
      runId: 'run_cross_sell',
      stepId: 'act',
      kind: 'observed',
      outcomeCode: 'accepted',
      observedAt: '2000-01-01T00:00:00.000Z',
      source: { kind: 'human', eventId: 'old-event' },
      note: 'Impossible historic observation.',
      evidenceLinks: ['/evidence'],
    };
    await assert.rejects(
      store.recordActionOutcome(base, 'org_bharat', 'rm@bank.local'),
      store.ActionOutcomeValidationError,
    );
    await assert.rejects(
      store.recordActionOutcome(
        { ...base, observedAt: new Date(Date.now() + 60_000).toISOString(), source: { ...base.source, eventId: 'future-event' } },
        'org_bharat',
        'rm@bank.local',
      ),
      store.ActionOutcomeValidationError,
    );
  },
);
