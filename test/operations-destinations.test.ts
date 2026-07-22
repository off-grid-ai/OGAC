import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_DESTINATIONS,
  CONFIGURATION_DESTINATIONS,
  EDGE_DESTINATIONS,
  HEALTH_DESTINATIONS,
  NODE_DESTINATIONS,
  formatRelativeTime,
  legacyHealthHref,
  operationsDestination,
  topologyResourceHref,
  withRouteSearchParams,
} from '../src/lib/operations-destinations.ts';

test('Operations exposes each level-three place as a stable route', () => {
  assert.deepEqual(
    HEALTH_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['metrics', '/operations/health/metrics/explorer'],
      ['alerts', '/operations/health/metrics/alerts'],
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
  assert.deepEqual(
    NODE_DESTINATIONS.map(({ id, route }) => [id, route]),
    [
      ['nodes', '/operations/nodes'],
      ['clusters', '/operations/clusters'],
    ],
  );
});

test('topology resource routes encode registry identifiers and reject unknown kinds', () => {
  assert.equal(topologyResourceHref('nodes'), '/operations/nodes');
  assert.equal(topologyResourceHref('nodes', 'edge node/01'), '/operations/nodes/edge%20node%2F01');
  assert.equal(
    topologyResourceHref('clusters', 'cluster head'),
    '/operations/clusters/cluster%20head',
  );
  assert.throws(
    () => topologyResourceHref('unknown' as never),
    /Unknown topology resource kind: unknown/,
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
  assert.equal(legacyHealthHref({ tab: 'unknown' }), '/operations/health/metrics/explorer');
});

test('adapter run timestamps use stable relative labels', () => {
  const now = Date.parse('2026-07-18T12:00:00.000Z');
  assert.equal(formatRelativeTime(null, now), 'never');
  assert.equal(formatRelativeTime('invalid', now), 'never');
  assert.equal(formatRelativeTime('2026-07-18T12:00:10.000Z', now), '0s ago');
  assert.equal(formatRelativeTime('2026-07-18T11:59:40.000Z', now), '20s ago');
  assert.equal(formatRelativeTime('2026-07-18T11:30:00.000Z', now), '30m ago');
  assert.equal(formatRelativeTime('2026-07-18T06:00:00.000Z', now), '6h ago');
  assert.equal(formatRelativeTime('2026-07-16T12:00:00.000Z', now), '2d ago');
});
