import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Pool } from 'pg';
import type { ActionReceipt } from '@/lib/action-contract';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';
import { prepareActionOutcomeSchema } from './support/action-outcome-schema.mjs';

const dbUp = await dbReachable();
const previous = {
  databaseUrl: process.env.DATABASE_URL,
  org: process.env.OFFGRID_ORG,
  token: process.env.OFFGRID_ADMIN_TOKEN,
  authSecret: process.env.AUTH_SECRET,
};
const prepared = dbUp ? await prepareActionOutcomeSchema('route') : null;
if (prepared) process.env.DATABASE_URL = prepared.databaseUrl;
process.env.OFFGRID_ORG = 'org_bharat';
process.env.OFFGRID_ADMIN_TOKEN = 'outcome-route-store-test';
process.env.AUTH_SECRET = 'outcome-route-store-test-secret-32';

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

function request(method: string, body?: Record<string, unknown>): Request {
  return new Request('http://console.local/api/outcomes', {
    method,
    headers: {
      authorization: 'Bearer outcome-route-store-test',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test(
  'real routes retain accepted to converted evidence, replay, correction, withdrawal and scoped reads',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const collection =
      await import('../src/app/api/v1/admin/app-runs/[id]/actions/[stepId]/outcomes/route.ts');
    const item =
      await import('../src/app/api/v1/admin/app-runs/[id]/actions/[stepId]/outcomes/[outcomeId]/route.ts');
    const pool = new Pool({ connectionString: prepared!.databaseUrl });
    const executedAt = new Date(Date.now() - 60_000).toISOString();
    const observedAt = new Date(Date.now() - 30_000).toISOString();
    const receipt: ActionReceipt = {
      actionId: 'crm.create-task',
      label: 'Create CRM follow-up task',
      system: 'CRM',
      orgId: 'org_bharat',
      runId: 'run_route_cross_sell',
      stepId: 'act_follow_up',
      connectorId: 'crm_bharat',
      target: 'opp_101',
      idempotencyKey: 'action:route-cross-sell-101',
      status: 'executed',
      executedAt,
      approval: { stepId: 'review', evidence: 'RM approved', reviewer: 'rm@bank.local' },
      providerReceipt: { signature: 'signed-provider-receipt' },
    };
    await pool.query(`INSERT INTO apps (id, org_id) VALUES ($1, $2)`, [
      'app_route_cross_sell',
      receipt.orgId,
    ]);
    await pool.query(
      `INSERT INTO app_runs (id, org_id, app_id, steps, finished_at)
       VALUES ($1, $2, $3, $4::jsonb, now())`,
      [
        receipt.runId,
        receipt.orgId,
        'app_route_cross_sell',
        JSON.stringify([
          { id: 'review', kind: 'human', label: 'RM review', status: 'done' },
          {
            id: receipt.stepId,
            kind: 'action',
            label: receipt.label,
            status: 'done',
            actionReceipt: receipt,
          },
        ]),
      ],
    );

    const routeParams = {
      params: Promise.resolve({ id: receipt.runId, stepId: receipt.stepId }),
    };
    const acceptedBody = {
      outcomeCode: 'accepted',
      observedAt,
      eventId: 'route-accepted-101',
      note: 'Customer accepted during the recorded follow-up.',
    };
    const acceptedResponse = await collection.POST(request('POST', acceptedBody), routeParams);
    assert.equal(acceptedResponse.status, 201);
    const accepted = await acceptedResponse.json();
    assert.equal(accepted.replayed, false);
    assert.equal(accepted.observation.outcomeCode, 'accepted');
    assert.deepEqual(accepted.observation.actionReceipt, receipt);
    assert.deepEqual(accepted.observation.evidenceLinks, [
      '/operations/runs/app%3Arun_route_cross_sell',
    ]);

    const replayResponse = await collection.POST(request('POST', acceptedBody), routeParams);
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.observation.id, accepted.observation.id);

    const convertedResponse = await collection.POST(
      request('POST', {
        ...acceptedBody,
        outcomeCode: 'converted',
        eventId: 'route-converted-101',
        note: 'Customer completed the product application.',
        measurement: {
          metricName: 'Incremental revenue',
          metricUnit: 'INR',
          resultValue: 25_000,
        },
      }),
      routeParams,
    );
    assert.equal(convertedResponse.status, 201);
    const converted = await convertedResponse.json();
    assert.notEqual(converted.observation.id, accepted.observation.id);

    const listResponse = await collection.GET(request('GET'), routeParams);
    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json();
    assert.deepEqual(
      listed.data.map((record: { outcomeCode: string }) => record.outcomeCode),
      ['accepted', 'converted'],
    );

    const acceptedParams = {
      params: Promise.resolve({
        id: receipt.runId,
        stepId: receipt.stepId,
        outcomeId: accepted.observation.id,
      }),
    };
    const detailResponse = await item.GET(request('GET'), acceptedParams);
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).observation.id, accepted.observation.id);

    const correctionResponse = await item.PATCH(
      request('PATCH', {
        outcomeCode: 'rejected',
        observedAt,
        eventId: 'route-correction-101',
        note: 'RM corrected the original response after checking the CRM note.',
      }),
      acceptedParams,
    );
    assert.equal(correctionResponse.status, 201);
    const correction = await correctionResponse.json();
    assert.equal(correction.observation.kind, 'corrected');
    assert.equal(correction.observation.outcomeCode, 'rejected');
    assert.equal(correction.observation.supersedesId, accepted.observation.id);

    const convertedParams = {
      params: Promise.resolve({
        id: receipt.runId,
        stepId: receipt.stepId,
        outcomeId: converted.observation.id,
      }),
    };
    const withdrawalResponse = await item.DELETE(
      request('DELETE', {
        observedAt,
        eventId: 'route-withdrawal-101',
        note: 'CRM reversed the conversion record.',
      }),
      convertedParams,
    );
    assert.equal(withdrawalResponse.status, 201);
    const withdrawal = await withdrawalResponse.json();
    assert.equal(withdrawal.observation.kind, 'withdrawn');
    assert.equal(withdrawal.observation.supersedesId, converted.observation.id);

    const wrongStep = await item.GET(request('GET'), {
      params: Promise.resolve({
        runId: receipt.runId,
        stepId: 'different_action',
        outcomeId: accepted.observation.id,
      }),
    });
    assert.equal(wrongStep.status, 404);

    const finalList = await collection.GET(request('GET'), routeParams);
    assert.equal(finalList.status, 200);
    assert.deepEqual(
      (await finalList.json()).data.map((record: { kind: string }) => record.kind),
      ['observed', 'observed', 'corrected', 'withdrawn'],
    );
    await pool.end();
  },
);
