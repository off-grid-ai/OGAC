import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDialect, execConnectorQuery, listResources, recordCount, testConnection } from '@/lib/connector-exec';

// UNIT tests for the extracted connector query path (Builder Epic Phase 0). detectDialect is pure
// (no I/O); recordCount/execConnectorQuery are exercised against unreachable/invalid targets where
// the CONTRACT is "return null, never fabricate" — provable without a live source.

test('detectDialect maps (type, endpoint) to a live-query strategy', () => {
  assert.equal(detectDialect('postgres', 'postgres://u@h/db'), 'postgres');
  assert.equal(detectDialect('database', 'postgresql://u@h/db'), 'postgres');
  assert.equal(detectDialect('mysql', 'mysql://u@h/db'), 'mysql');
  assert.equal(detectDialect('mssql', 'mssql://u@h/db'), 'mssql');
  assert.equal(detectDialect('rest', 'https://api.example.com'), 'rest');
  assert.equal(detectDialect('crm', 'http://crm.local/api'), 'rest');
});

test('detectDialect returns null when type/endpoint scheme mismatch or non-DB', () => {
  // Declared postgres but endpoint is not a postgres URL → no strategy.
  assert.equal(detectDialect('postgres', 'https://nope'), null);
  // Unknown connector type with a bare string endpoint.
  assert.equal(detectDialect('s3', 's3://bucket'), null);
  assert.equal(detectDialect('', ''), null);
});

test('detectDialect maps an Odoo connector (both endpoint forms) to the odoo dialect', () => {
  assert.equal(detectDialect('odoo', 'odoo://admin:pw@erp.internal:8069/prod'), 'odoo');
  assert.equal(detectDialect('Odoo ERP', 'https://erp.example.com/odoo?db=prod'), 'odoo');
});

test('detectDialect does NOT match odoo when the endpoint is unparseable (no fake dialect)', () => {
  // odoo type but an https endpoint with no db → parseOdooEndpoint fails; the 'odoo' type doesn't
  // contain rest/http/api/crm, so REST doesn't match either → null (never a wrong dialect).
  assert.equal(detectDialect('odoo', 'https://erp.example.com/odoo'), null);
  // odoo type with a bare non-URL endpoint → no strategy at all.
  assert.equal(detectDialect('odoo', 'not-a-url'), null);
});

test('recordCount returns null for a non-DB / unmatched connector (no fabrication)', async () => {
  assert.equal(await recordCount('s3', 's3://bucket'), null);
});

test('recordCount returns null for an unreachable Postgres endpoint', async () => {
  // Unroutable host + short timeout → connection fails → null, not a made-up count.
  const n = await recordCount('postgres', 'postgres://u:p@127.0.0.1:1/does_not_exist');
  assert.equal(n, null);
});

test('execConnectorQuery returns null when no dialect matches', async () => {
  const r = await execConnectorQuery({ type: 's3', endpoint: 's3://b' }, { resource: 'x' });
  assert.equal(r, null);
});

test('execConnectorQuery rejects an unsafe SQL identifier before connecting', async () => {
  // A resource with injection characters must be refused (returns null) rather than interpolated.
  const r = await execConnectorQuery(
    { type: 'postgres', endpoint: 'postgres://u:p@127.0.0.1:1/db' },
    { resource: 'users; DROP TABLE users' },
  );
  assert.equal(r, null);
});

test('execConnectorQuery returns null for an unreachable REST source', async () => {
  const r = await execConnectorQuery(
    { type: 'rest', endpoint: 'http://127.0.0.1:1/api' },
    { resource: 'accounts' },
  );
  assert.equal(r, null);
});

// ─── Odoo degrade behaviour — the connector honestly returns null/failure when Odoo is unreachable ─
test('execConnectorQuery returns null for an unreachable Odoo source (no fabricated rows)', async () => {
  const r = await execConnectorQuery(
    { type: 'odoo', endpoint: 'odoo://admin:pw@127.0.0.1:1/prod' },
    { resource: 'res.partner' },
  );
  assert.equal(r, null);
});

test('execConnectorQuery returns null for an Odoo query with no resource (model) named', async () => {
  const r = await execConnectorQuery(
    { type: 'odoo', endpoint: 'odoo://admin:pw@127.0.0.1:1/prod' },
    { resource: '' },
  );
  assert.equal(r, null);
});

test('recordCount returns null for an unreachable Odoo endpoint', async () => {
  const n = await recordCount('odoo', 'odoo://admin:pw@127.0.0.1:1/prod');
  assert.equal(n, null);
});

test('testConnection reports an honest failure for an unreachable Odoo instance', async () => {
  const res = await testConnection({ type: 'odoo', endpoint: 'odoo://admin:pw@127.0.0.1:1/prod' });
  assert.equal(res.ok, false);
  assert.equal(res.dialect, 'odoo');
  assert.match(res.message, /Odoo/);
});

test('testConnection flags an unparseable Odoo endpoint as a config error', async () => {
  // odoo type but the https endpoint has no db → detectDialect falls to REST, so force via odoo:// w/o db.
  const res = await testConnection({ type: 'odoo', endpoint: 'odoo://admin:pw@127.0.0.1:1' });
  // No db path → detectDialect returns null → the generic "cannot be queried live yet" message.
  assert.equal(res.ok, false);
  assert.equal(res.dialect, null);
});

test('listResources returns null for an unreachable Odoo instance', async () => {
  const r = await listResources({ type: 'odoo', endpoint: 'odoo://admin:pw@127.0.0.1:1/prod' });
  assert.equal(r, null);
});
