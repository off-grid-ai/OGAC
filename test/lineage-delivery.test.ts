import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lineageDeliveryReceipt,
  lineageDeliverySummary,
} from '../src/lib/lineage-delivery.ts';

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
