import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_DESTINATIONS,
  CONFIGURATION_DESTINATIONS,
  EDGE_DESTINATIONS,
  HEALTH_DESTINATIONS,
  legacyHealthHref,
  operationsDestination,
  withRouteSearchParams,
} from '../src/lib/operations-destinations.ts';

test('Operations exposes each level-three place as a stable route', () => {
  assert.deepEqual(
    HEALTH_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['metrics', '/operations/health/metrics'],
      ['logs', '/operations/health/logs'],
      ['traces', '/operations/health/traces'],
    ],
  );
  assert.deepEqual(
    CONFIGURATION_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['settings', '/operations/configuration/settings'],
      ['feature-flags', '/operations/configuration/feature-flags'],
      ['adapters', '/operations/configuration/adapters'],
      ['messaging', '/operations/configuration/messaging'],
    ],
  );
  assert.deepEqual(
    EDGE_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['overview', '/operations/edge/overview'],
      ['waf', '/operations/edge/waf'],
      ['traffic', '/operations/edge/traffic'],
      ['blocked-requests', '/operations/edge/blocked-requests'],
    ],
  );
  assert.deepEqual(
    ADMIN_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['organization', '/operations/admin/organization'],
      ['tenants', '/operations/admin/tenants'],
    ],
  );
});

test('destination lookup rejects unknown leaves', () => {
  assert.equal(operationsDestination(EDGE_DESTINATIONS, 'waf'), EDGE_DESTINATIONS[1]);
  assert.equal(operationsDestination(EDGE_DESTINATIONS, 'missing'), undefined);
  assert.equal(operationsDestination(EDGE_DESTINATIONS, undefined), undefined);
});

test('route query serialization preserves repeated and scalar filters', () => {
  assert.equal(
    withRouteSearchParams('/operations/edge/traffic', {
      q: 'api host',
      status: ['200', '429'],
      empty: undefined,
    }),
    '/operations/edge/traffic?q=api+host&status=200&status=429',
  );
  assert.equal(withRouteSearchParams('/operations/edge/overview', {}), '/operations/edge/overview');
});

test('legacy health tabs become durable leaves without losing filters', () => {
  assert.equal(
    legacyHealthHref({ tab: 'logs', logsq: '_stream:{app="console"}' }),
    '/operations/health/logs?logsq=_stream%3A%7Bapp%3D%22console%22%7D',
  );
  assert.equal(
    legacyHealthHref({ tab: ['traces'], svc: 'gateway' }),
    '/operations/health/traces?svc=gateway',
  );
  assert.equal(legacyHealthHref({ tab: 'unknown' }), '/operations/health/metrics');
});
