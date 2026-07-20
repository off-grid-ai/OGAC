import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queueGatewayHeaders } from '../packages/gateway/src/queue/activities.ts';

test('queue gateway auth prefers an explicit bearer over static keys', () => {
  assert.deepEqual(
    queueGatewayHeaders({
      OFFGRID_QUEUE_GATEWAY_BEARER_TOKEN: 'queue-jwt',
      OFFGRID_QUEUE_GATEWAY_API_KEY: 'queue-key',
      OFFGRID_GATEWAY_API_KEY: 'legacy-key',
    }),
    { authorization: 'Bearer queue-jwt' },
  );
});

test('queue gateway auth uses the queue key, then the canonical gateway key', () => {
  assert.deepEqual(
    queueGatewayHeaders({
      OFFGRID_QUEUE_GATEWAY_API_KEY: 'queue-key',
      OFFGRID_GATEWAY_API_KEY: 'legacy-key',
    }),
    { 'x-api-key': 'queue-key' },
  );
  assert.deepEqual(queueGatewayHeaders({ OFFGRID_GATEWAY_API_KEY: 'legacy-key' }), {
    'x-api-key': 'legacy-key',
  });
  assert.deepEqual(queueGatewayHeaders({}), {});
});
