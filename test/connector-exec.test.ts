import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDialect, execConnectorQuery, recordCount } from '@/lib/connector-exec';

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
