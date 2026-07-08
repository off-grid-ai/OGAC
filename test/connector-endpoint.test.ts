import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  splitEndpointSecret,
  endpointHasEmbeddedSecret,
} from '../src/lib/connector-endpoint.ts';
// Round-trip partner: peeling a secret out then splicing it back must reproduce a working URL.
import { spliceCredential } from '../src/lib/connector-policy.ts';

// PURE unit tests for the endpoint-splitter — the inverse of connector-policy.spliceCredential.
// Proves the edit/update path can peel a pasted password off any SQL connection string so the DB
// row stays credential-free, and that it never corrupts a REST / already-clean / unparseable string.

test('splits an embedded password off a postgres URL, keeps the user', () => {
  const r = splitEndpointSecret('postgres://sa:Sup3rSecret!@db.acme.co:5432/corebank');
  assert.equal(r.secret, 'Sup3rSecret!');
  assert.equal(r.endpoint, 'postgres://sa@db.acme.co:5432/corebank');
  assert.ok(!r.endpoint.includes('Sup3rSecret'), 'password stripped from the endpoint');
});

test('handles every SQL scheme (postgres/postgresql/mysql/mariadb/mssql/sqlserver)', () => {
  for (const scheme of ['postgres', 'postgresql', 'mysql', 'mariadb', 'mssql', 'sqlserver']) {
    const r = splitEndpointSecret(`${scheme}://u:p@h:1234/db`);
    assert.equal(r.secret, 'p', `${scheme} secret extracted`);
    assert.equal(r.endpoint, `${scheme}://u@h:1234/db`, `${scheme} endpoint sanitized`);
  }
});

test('percent-encoded password is decoded to its real value on the way out', () => {
  const r = splitEndpointSecret('mysql://u:p%40ss%3Aword@h:3306/d');
  assert.equal(r.secret, 'p@ss:word');
  assert.equal(r.endpoint, 'mysql://u@h:3306/d');
});

test('a SQL URL WITHOUT a password is returned unchanged, secret=null', () => {
  const clean = 'postgres://reader@db.acme.co:5432/corebank';
  const r = splitEndpointSecret(clean);
  assert.equal(r.secret, null);
  assert.equal(r.endpoint, clean);
});

test('REST base URLs never split a secret out (api key is a header)', () => {
  const r = splitEndpointSecret('https://api.acme.co/v1');
  assert.equal(r.secret, null);
  assert.equal(r.endpoint, 'https://api.acme.co/v1');
});

test('a non-URL / unparseable string is passed straight through', () => {
  assert.deepEqual(splitEndpointSecret('not a url'), { endpoint: 'not a url', secret: null });
  // A SQL-scheme prefix that is not a valid URL must not throw or corrupt.
  assert.deepEqual(splitEndpointSecret('postgres://['), { endpoint: 'postgres://[', secret: null });
});

test('empty / whitespace endpoint → empty, secret=null', () => {
  assert.deepEqual(splitEndpointSecret(''), { endpoint: '', secret: null });
  assert.deepEqual(splitEndpointSecret('   '), { endpoint: '', secret: null });
});

test('endpointHasEmbeddedSecret flags only URLs that actually carry a password', () => {
  assert.equal(endpointHasEmbeddedSecret('mssql://sa:PASS@host/db'), true);
  assert.equal(endpointHasEmbeddedSecret('mssql://sa@host/db'), false);
  assert.equal(endpointHasEmbeddedSecret('https://api.acme.co'), false);
  assert.equal(endpointHasEmbeddedSecret(''), false);
});

test('round-trip: split then spliceCredential reproduces a working URL', () => {
  const original = 'postgres://reader:Sup3rSecret!@db.acme.co:5432/corebank';
  const { endpoint, secret } = splitEndpointSecret(original);
  assert.equal(secret, 'Sup3rSecret!');
  const rebuilt = spliceCredential('postgres', endpoint, secret!);
  const u = new URL(rebuilt);
  assert.equal(u.username, 'reader');
  assert.equal(decodeURIComponent(u.password), 'Sup3rSecret!');
  assert.equal(u.hostname, 'db.acme.co');
  assert.equal(u.port, '5432');
  assert.equal(u.pathname, '/corebank');
});
