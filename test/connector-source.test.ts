import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeConnectorSource, type ConnectorSourceDeps } from '../src/lib/retrieval/connector-source.ts';
import type { DataDomain } from '../src/lib/data-domains.ts';

// Tests the connector retrieval source's ROUTING behaviour without a live DB/connector, using the
// injectable deps seam. Proves: names a declared domain → routes to its connector + reads; names
// nothing declared → contributes nothing; missing connector / failed read → nothing (no fabrication).

const HR: DataDomain = {
  id: 'dom_hr',
  orgId: 'default',
  label: 'Employee Quota',
  aliases: ['reimbursement quota', 'quota'],
  connectorId: 'con_hr',
  resource: 'employee_quota',
};

// A minimal fake connector matching the store's Connector shape (only fields the source reads).
const CONN = {
  id: 'con_hr',
  name: 'HR DB',
  type: 'postgres',
  status: 'connected',
  lastSync: null,
  endpoint: 'postgres://x',
  auth: 'none',
  description: '',
  custom: false,
};

function deps(overrides: Partial<ConnectorSourceDeps> = {}): ConnectorSourceDeps {
  return {
    listDomains: async () => [HR],
    listConnectors: async () => [CONN],
    queryDomain: async (domain) => ({
      result: {
        rows: [{ id: 1, employee: 'alice', quota: 500 }, { id: 2, employee: 'bob', quota: 300 }],
        count: 2,
        dialect: 'postgres',
      },
      decision: {
        domainId: domain.id,
        domainLabel: domain.label,
        connectorId: domain.connectorId,
        resource: domain.resource,
        op: 'read',
        ok: true,
        rowsReturned: 2,
        dialect: 'postgres',
      },
    }),
    ...overrides,
  };
}

test('a query naming a declared domain routes to the connector and returns hits', async () => {
  const src = makeConnectorSource(deps());
  const hits = await src.search('what is the employee quota', 10);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].sourceId, 'connector');
  assert.equal(hits[0].sourceKind, 'database');
  assert.match(hits[0].ref, /^connector:con_hr\/employee_quota#0$/);
  assert.ok(hits[0].title.includes('Employee Quota'));
});

test('a query naming NOTHING declared contributes nothing (no-guess)', async () => {
  const src = makeConnectorSource(deps());
  const hits = await src.search('tomorrow weather forecast', 10);
  assert.deepEqual(hits, []);
});

test('missing connector for a resolved domain → nothing (never fabricate)', async () => {
  const src = makeConnectorSource(deps({ listConnectors: async () => [] }));
  const hits = await src.search('employee quota', 10);
  assert.deepEqual(hits, []);
});

test('failed live read (null result) → nothing', async () => {
  const src = makeConnectorSource(
    deps({
      queryDomain: async (domain) => ({
        result: null,
        decision: {
          domainId: domain.id,
          domainLabel: domain.label,
          connectorId: domain.connectorId,
          resource: domain.resource,
          op: 'read',
          ok: false,
          rowsReturned: null,
          dialect: null,
        },
      }),
    }),
  );
  const hits = await src.search('employee quota', 10);
  assert.deepEqual(hits, []);
});

test('hits are capped at k', async () => {
  const src = makeConnectorSource(
    deps({
      queryDomain: async (domain) => ({
        result: {
          rows: Array.from({ length: 20 }, (_, i) => ({ id: i })),
          count: 20,
          dialect: 'postgres',
        },
        decision: {
          domainId: domain.id, domainLabel: domain.label, connectorId: domain.connectorId,
          resource: domain.resource, op: 'read', ok: true, rowsReturned: 20, dialect: 'postgres',
        },
      }),
    }),
  );
  const hits = await src.search('employee quota', 3);
  assert.equal(hits.length, 3);
});

test('exposes the RetrievalSource shape', () => {
  const src = makeConnectorSource(deps());
  assert.equal(src.id, 'connector');
  assert.equal(src.kind, 'database');
  assert.equal(typeof src.search, 'function');
});
