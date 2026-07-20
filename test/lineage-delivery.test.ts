import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lineageDeliveryReceipt,
  lineageDeliverySummary,
} from '../src/lib/lineage-delivery.ts';
import { createMarquezLineage, nullLineage } from '../src/lib/adapters/lineage.ts';

const EVENT = {
  job: 'brain.retrieve.qdrant',
  run: 'run-uuid',
  status: 'COMPLETE' as const,
  inputs: ['claims-rules'],
  outputs: ['retrieval-result'],
};
const NOW = () => new Date('2026-07-20T00:00:00.000Z');

test('lineage delivery evidence preserves correlation and formats failure state', () => {
  const receipt = lineageDeliveryReceipt({
    adapterId: 'marquez',
    job: 'brain.retrieve.qdrant',
    runId: 'run-uuid',
    status: 'rejected',
    httpStatus: 503,
    attemptedAt: '2026-07-20T00:00:00.000Z',
    detail: 'Marquez rejected the event (HTTP 503).',
  });
  assert.deepEqual(receipt, {
    adapterId: 'marquez',
    job: 'brain.retrieve.qdrant',
    runId: 'run-uuid',
    status: 'rejected',
    httpStatus: 503,
    attemptedAt: '2026-07-20T00:00:00.000Z',
    detail: 'Marquez rejected the event (HTTP 503).',
  });
  assert.equal(lineageDeliverySummary(receipt), 'lineage=marquez:rejected http=503 run=run-uuid');
});

test('native lineage reports implicit evidence instead of fabricating delivery', async () => {
  const receipt = await nullLineage.emit(EVENT);
  assert.equal(receipt.status, 'implicit');
  assert.equal(receipt.httpStatus, null);
  assert.equal(receipt.runId, 'run-uuid');
});

test('Marquez reports not-configured without calling the network boundary', async () => {
  let calls = 0;
  const adapter = createMarquezLineage({
    baseUrl: '',
    now: NOW,
    fetcher: async () => {
      calls += 1;
      return new Response(null, { status: 201 });
    },
  });
  const receipt = await adapter.emit(EVENT);
  assert.equal(receipt.status, 'not-configured');
  assert.equal(calls, 0);
});

test('Marquez distinguishes accepted, rejected, and unreachable delivery', async () => {
  const accepted = createMarquezLineage({
    baseUrl: 'http://marquez.local/',
    now: NOW,
    fetcher: async (url, init) => {
      assert.equal(url, 'http://marquez.local/api/v1/lineage');
      assert.equal(init?.method, 'POST');
      assert.match(String(init?.body), /brain\.retrieve\.qdrant/);
      return new Response(null, { status: 201 });
    },
  });
  assert.deepEqual(await accepted.emit(EVENT), {
    adapterId: 'marquez',
    job: 'brain.retrieve.qdrant',
    runId: 'run-uuid',
    status: 'accepted',
    httpStatus: 201,
    attemptedAt: '2026-07-20T00:00:00.000Z',
    detail: 'Marquez accepted the OpenLineage event (HTTP 201).',
  });

  const rejected = createMarquezLineage({
    baseUrl: 'http://marquez.local',
    now: NOW,
    fetcher: async () => new Response(null, { status: 422 }),
  });
  assert.equal((await rejected.emit(EVENT)).status, 'rejected');
  assert.equal((await rejected.emit(EVENT)).httpStatus, 422);

  const unreachable = createMarquezLineage({
    baseUrl: 'http://marquez.local',
    now: NOW,
    fetcher: async () => {
      throw new Error('connection refused');
    },
  });
  const failed = await unreachable.emit(EVENT);
  assert.equal(failed.status, 'unreachable');
  assert.match(failed.detail, /connection refused/);
});
