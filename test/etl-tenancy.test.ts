// The Airbyte replication CONNECTION ownership boundary — the first of two confirmed cross-tenant
// leaks fixed 2026-08-05 (see docs/audit/2026-08-05-viewer/data.md). `/data/flows/replication`
// rendered pixel-identical content on both public demo tenants: a connection named "CoreBank to Off
// Grid Warehouse" appeared on the insurer's own screen. Airbyte's connections carry no org field at
// all, so ownership is decided here by cross-referencing the connection's SOURCE database against the
// org's own registered connectors — real production shapes, not invented ones.
//
// Shaped like test/langfuse-tenancy.test.ts: pure functions, no mocks, real returned values.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_CONNECTIONS,
  connectorResourceKey,
  filterConnectionsForScope,
  isConnectionOwned,
  ownedResourceKeys,
  sourceDatabaseKey,
} from '../src/lib/etl-tenancy.ts';

// The live shapes, verified on the box: the one real connection's source is a Postgres reading
// database `corebank`; org_bharat's own connector registry has `bhcon_corebank` pointed at the same
// database via its endpoint. org_suraksha has no connector anywhere near it.
const corebankSource = {
  sourceId: 'ab592918-f2ac-45f0-ab9b-d8360e7e8d44',
  connectionConfiguration: { host: 'host.docker.internal', port: 15433, database: 'corebank' },
};
const bharatConnectors = [
  { endpoint: 'postgres://corebank@127.0.0.1:5433/corebank' },
  { endpoint: 'mysql://policyadmin@127.0.0.1:3307/policyadmin' },
];
const surakshaConnectors = [
  { endpoint: 'postgres://coreins@127.0.0.1:5433/suraksha' },
  { endpoint: 'mysql://policyadmin@127.0.0.1:3307/suraksha' },
];

test('sourceDatabaseKey reads the source config database, case/whitespace-insensitively', () => {
  assert.equal(sourceDatabaseKey(corebankSource), 'corebank');
  assert.equal(
    sourceDatabaseKey({ connectionConfiguration: { database: '  CoreBank  ' } }),
    'corebank',
  );
});

test('sourceDatabaseKey resolves to null (unattributable) on any malformed/absent shape', () => {
  assert.equal(sourceDatabaseKey(null), null);
  assert.equal(sourceDatabaseKey('not-an-object'), null);
  assert.equal(sourceDatabaseKey({}), null);
  assert.equal(sourceDatabaseKey({ connectionConfiguration: null }), null);
  assert.equal(sourceDatabaseKey({ connectionConfiguration: 'nope' }), null);
  assert.equal(sourceDatabaseKey({ connectionConfiguration: { database: '' } }), null);
  assert.equal(sourceDatabaseKey({ connectionConfiguration: { database: 42 } }), null);
  // A Kafka/REST source with no `database` field at all — the honest unattributable case, not a bug.
  assert.equal(sourceDatabaseKey({ connectionConfiguration: { host: 'x', port: 1 } }), null);
});

test('connectorResourceKey extracts the trailing database name from a connection string', () => {
  assert.equal(connectorResourceKey('postgres://corebank@127.0.0.1:5433/corebank'), 'corebank');
  assert.equal(connectorResourceKey('mysql://policyadmin@127.0.0.1:3307/suraksha'), 'suraksha');
  assert.equal(connectorResourceKey('mssql://sa@127.0.0.1:1433/erp'), 'erp');
});

test('connectorResourceKey resolves to null for endpoints with no resource path', () => {
  assert.equal(connectorResourceKey('kafka://127.0.0.1:8948'), null);
  assert.equal(connectorResourceKey('http://127.0.0.1:9010'), null);
  assert.equal(connectorResourceKey(''), null);
  assert.equal(connectorResourceKey(null), null);
  assert.equal(connectorResourceKey(undefined), null);
  assert.equal(connectorResourceKey('   '), null);
});

test('a connection is owned only by the org whose connector targets the same database', () => {
  const corebankDb = sourceDatabaseKey(corebankSource);
  assert.equal(isConnectionOwned(corebankDb, ownedResourceKeys(bharatConnectors.map((c) => c.endpoint))), true);
  assert.equal(
    isConnectionOwned(corebankDb, ownedResourceKeys(surakshaConnectors.map((c) => c.endpoint))),
    false,
  );
});

test('an unattributable connection (null source database) belongs to NOBODY', () => {
  // The tempting alternative — treat "we can't tell" as visible everywhere — is the leak itself.
  const anyOrgsKeys = ownedResourceKeys(bharatConnectors.map((c) => c.endpoint));
  assert.equal(isConnectionOwned(null, anyOrgsKeys), false);
  assert.equal(isConnectionOwned(null, new Set()), false);
});

test('filterConnectionsForScope: the two demo tenants’ visible connections are disjoint', () => {
  const connections = [
    { connectionId: 'conn_corebank', name: 'CoreBank to Off Grid Warehouse' },
    { connectionId: 'conn_unattributable', name: 'Legacy sync' },
  ];
  const sourceDatabaseOf = new Map<string, string | null>([
    ['conn_corebank', 'corebank'],
    ['conn_unattributable', null],
  ]);

  const bharatScope = ownedResourceKeys(bharatConnectors.map((c) => c.endpoint));
  const surakshaScope = ownedResourceKeys(surakshaConnectors.map((c) => c.endpoint));

  const bharatView = filterConnectionsForScope(connections, sourceDatabaseOf, bharatScope);
  const surakshaView = filterConnectionsForScope(connections, sourceDatabaseOf, surakshaScope);

  // The bank owns CoreBank — its screen keeps the one attributable connection.
  assert.deepEqual(bharatView.map((c) => c.connectionId), ['conn_corebank']);
  // The insurer owns no connector reading `corebank` — its screen has NOTHING, honestly, rather than
  // showing the bank's connector under a false "shared" fallback.
  assert.deepEqual(surakshaView, []);
  // Disjoint — the exact property that failed live (byte-identical screens on both tenants).
  const overlap = bharatView.filter((a) => surakshaView.some((b) => b.connectionId === a.connectionId));
  assert.equal(overlap.length, 0);
});

test('filterConnectionsForScope: ALL_CONNECTIONS (platform/default-org) stays unscoped', () => {
  const connections = [{ connectionId: 'c1' }, { connectionId: 'c2' }];
  const sourceDatabaseOf = new Map<string, string | null>([
    ['c1', 'corebank'],
    ['c2', null],
  ]);
  assert.deepEqual(
    filterConnectionsForScope(connections, sourceDatabaseOf, ALL_CONNECTIONS),
    connections,
  );
});

test('filterConnectionsForScope: an empty owned-set (org with no matching connector) sees nothing', () => {
  const connections = [{ connectionId: 'c1' }];
  const sourceDatabaseOf = new Map<string, string | null>([['c1', 'corebank']]);
  assert.deepEqual(filterConnectionsForScope(connections, sourceDatabaseOf, new Set()), []);
});

test('ownership is an exact database match, never a prefix/substring', () => {
  const keys = ownedResourceKeys(['postgres://x@host:5433/bharat']);
  assert.equal(isConnectionOwned('bharatunion', keys), false);
  assert.equal(isConnectionOwned('bharat', keys), true);
});
