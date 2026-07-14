import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAuthPayload,
  buildModelListPayload,
  buildSearchReadPayload,
  parseAuthResult,
  parseModelListResult,
  parseOdooEndpoint,
  parseOdooInlinePassword,
  parseOdooLogin,
  parseSearchReadResult,
} from '@/lib/odoo-rpc';

// PURE unit tests for the Odoo JSON-RPC protocol layer. Every branch of parse/build/parse-result is
// exercised, including malformed bodies and Odoo `{error}` envelopes — the contract is "null on
// anything that isn't the expected success payload" so the I/O layer degrades honestly.

// ─── parseOdooEndpoint ──────────────────────────────────────────────────────────────────────────
test('parseOdooEndpoint parses odoo:// with user:pass, host and port', () => {
  assert.deepEqual(parseOdooEndpoint('odoo://admin:secret@erp.internal:8069/bharatprod'), {
    base: 'http://erp.internal:8069',
    db: 'bharatprod',
  });
});

test('parseOdooEndpoint parses odoo:// without a port (portless base)', () => {
  assert.deepEqual(parseOdooEndpoint('odoo://admin@erp.internal/bharatprod'), {
    base: 'http://erp.internal',
    db: 'bharatprod',
  });
});

test('parseOdooEndpoint URL-decodes the db segment', () => {
  assert.deepEqual(parseOdooEndpoint('odoo://u:p@h:8069/my%20db'), {
    base: 'http://h:8069',
    db: 'my db',
  });
});

test('parseOdooEndpoint parses https://host/odoo?db=NAME (path kept in base)', () => {
  assert.deepEqual(parseOdooEndpoint('https://erp.example.com/odoo?db=prod'), {
    base: 'https://erp.example.com/odoo',
    db: 'prod',
  });
});

test('parseOdooEndpoint parses http (not https) with a db query and no path', () => {
  assert.deepEqual(parseOdooEndpoint('http://localhost:8069?db=demo'), {
    base: 'http://localhost:8069',
    db: 'demo',
  });
});

test('parseOdooEndpoint strips a trailing slash from the http path', () => {
  assert.deepEqual(parseOdooEndpoint('https://h/odoo/?db=prod'), {
    base: 'https://h/odoo',
    db: 'prod',
  });
});

test('parseOdooEndpoint returns null when odoo:// has no db path segment', () => {
  assert.equal(parseOdooEndpoint('odoo://admin:secret@erp.internal:8069'), null);
  assert.equal(parseOdooEndpoint('odoo://admin:secret@erp.internal:8069/'), null);
});

test('parseOdooEndpoint returns null when https has no db query param', () => {
  assert.equal(parseOdooEndpoint('https://erp.example.com/odoo'), null);
  assert.equal(parseOdooEndpoint('https://erp.example.com/odoo?other=x'), null);
});

test('parseOdooEndpoint returns null on an unsupported scheme', () => {
  assert.equal(parseOdooEndpoint('ftp://host/db'), null);
  assert.equal(parseOdooEndpoint('postgres://u@h/db'), null);
});

test('parseOdooEndpoint returns null on blank or malformed input', () => {
  assert.equal(parseOdooEndpoint(''), null);
  assert.equal(parseOdooEndpoint('   '), null);
  assert.equal(parseOdooEndpoint('not a url'), null);
  // @ts-expect-error — defensive: null/undefined tolerated at runtime
  assert.equal(parseOdooEndpoint(undefined), null);
});

// ─── parseOdooLogin ─────────────────────────────────────────────────────────────────────────────
test('parseOdooLogin returns the userinfo login', () => {
  assert.equal(parseOdooLogin('odoo://svc_reader:pw@h:8069/db'), 'svc_reader');
});

test('parseOdooLogin URL-decodes the login', () => {
  assert.equal(parseOdooLogin('odoo://a%40b.com:pw@h/db'), 'a@b.com');
});

test('parseOdooLogin defaults to admin when no user or on malformed input', () => {
  assert.equal(parseOdooLogin('odoo://h:8069/db'), 'admin');
  assert.equal(parseOdooLogin('https://h/odoo?db=x'), 'admin');
  assert.equal(parseOdooLogin('not a url'), 'admin');
});

// ─── parseOdooInlinePassword ────────────────────────────────────────────────────────────────────
test('parseOdooInlinePassword returns the URL-decoded inline password when present', () => {
  assert.equal(parseOdooInlinePassword('odoo://svc:p%40ss@h:8069/db'), 'p@ss');
});

test('parseOdooInlinePassword returns empty string when absent or malformed', () => {
  assert.equal(parseOdooInlinePassword('odoo://svc@h:8069/db'), '');
  assert.equal(parseOdooInlinePassword('not a url'), '');
  assert.equal(parseOdooInlinePassword(''), '');
});

// ─── buildAuthPayload ───────────────────────────────────────────────────────────────────────────
test('buildAuthPayload builds a common.authenticate JSON-RPC envelope', () => {
  const p = buildAuthPayload('db1', 'admin', 'pw');
  assert.deepEqual(p, {
    jsonrpc: '2.0',
    method: 'call',
    params: { service: 'common', method: 'authenticate', args: ['db1', 'admin', 'pw', {}] },
    id: 1,
  });
});

test('buildAuthPayload honours a custom id', () => {
  assert.equal(buildAuthPayload('db', 'u', 'p', 42).id, 42);
});

// ─── buildSearchReadPayload ─────────────────────────────────────────────────────────────────────
test('buildSearchReadPayload builds object.execute_kw with default empty domain and no kwargs', () => {
  const p = buildSearchReadPayload({ db: 'db', uid: 2, password: 'pw', model: 'res.partner' });
  assert.deepEqual(p.params, {
    service: 'object',
    method: 'execute_kw',
    args: ['db', 2, 'pw', 'res.partner', 'search_read', [[]], {}],
  });
});

test('buildSearchReadPayload includes fields, limit, offset, and a custom domain when given', () => {
  const p = buildSearchReadPayload({
    db: 'db',
    uid: 2,
    password: 'pw',
    model: 'crm.lead',
    fields: ['name', 'email'],
    domain: [['active', '=', true]],
    limit: 50,
    offset: 10,
  });
  const args = (p.params as { args: unknown[] }).args;
  assert.deepEqual(args[5], [[['active', '=', true]]]); // domain wrapped in the positional array
  assert.deepEqual(args[6], { fields: ['name', 'email'], limit: 50, offset: 10 });
});

test('buildSearchReadPayload omits empty fields array from kwargs', () => {
  const p = buildSearchReadPayload({ db: 'db', uid: 1, password: 'p', model: 'm', fields: [] });
  const kwargs = (p.params as { args: unknown[] }).args[6];
  assert.deepEqual(kwargs, {});
});

// ─── buildModelListPayload ──────────────────────────────────────────────────────────────────────
test('buildModelListPayload queries ir.model with the model field and a default limit', () => {
  const p = buildModelListPayload({ db: 'db', uid: 3, password: 'pw' });
  const args = (p.params as { args: unknown[] }).args;
  assert.equal(args[3], 'ir.model');
  assert.equal(args[4], 'search_read');
  assert.deepEqual(args[6], { fields: ['model'], limit: 500 });
});

test('buildModelListPayload honours a custom limit and id', () => {
  const p = buildModelListPayload({ db: 'db', uid: 3, password: 'pw', limit: 10 }, 7);
  const args = (p.params as { args: unknown[] }).args;
  assert.deepEqual(args[6], { fields: ['model'], limit: 10 });
  assert.equal(p.id, 7);
});

// ─── parseAuthResult ────────────────────────────────────────────────────────────────────────────
test('parseAuthResult returns the uid on a positive integer result', () => {
  assert.equal(parseAuthResult({ jsonrpc: '2.0', id: 1, result: 7 }), 7);
});

test('parseAuthResult returns null for false / 0 / non-integer / missing result', () => {
  assert.equal(parseAuthResult({ result: false }), null);
  assert.equal(parseAuthResult({ result: 0 }), null);
  assert.equal(parseAuthResult({ result: -3 }), null);
  assert.equal(parseAuthResult({ result: 2.5 }), null);
  assert.equal(parseAuthResult({ result: 'nope' }), null);
  assert.equal(parseAuthResult({ jsonrpc: '2.0', id: 1 }), null);
});

test('parseAuthResult returns null on an error envelope', () => {
  assert.equal(parseAuthResult({ error: { code: 100, message: 'Access Denied' } }), null);
});

test('parseAuthResult returns null on malformed / non-object bodies', () => {
  assert.equal(parseAuthResult(null), null);
  assert.equal(parseAuthResult(undefined), null);
  assert.equal(parseAuthResult('string'), null);
  assert.equal(parseAuthResult(42), null);
  assert.equal(parseAuthResult([]), null);
});

// ─── parseSearchReadResult ──────────────────────────────────────────────────────────────────────
test('parseSearchReadResult returns the record array on a well-formed result', () => {
  const rows = parseSearchReadResult({ result: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
  assert.deepEqual(rows, [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
});

test('parseSearchReadResult returns an empty array for an empty result', () => {
  assert.deepEqual(parseSearchReadResult({ result: [] }), []);
});

test('parseSearchReadResult drops non-object entries (never fakes rows)', () => {
  const rows = parseSearchReadResult({ result: [{ id: 1 }, 'junk', null, [1, 2], { id: 2 }] });
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
});

test('parseSearchReadResult returns null on error envelope, non-array, or malformed body', () => {
  assert.equal(parseSearchReadResult({ error: { message: 'boom' } }), null);
  assert.equal(parseSearchReadResult({ result: { not: 'an array' } }), null);
  assert.equal(parseSearchReadResult({ result: 'x' }), null);
  assert.equal(parseSearchReadResult({}), null);
  assert.equal(parseSearchReadResult(null), null);
  assert.equal(parseSearchReadResult('str'), null);
});

// ─── parseModelListResult ───────────────────────────────────────────────────────────────────────
test('parseModelListResult returns sorted unique model names', () => {
  const names = parseModelListResult({
    result: [{ model: 'res.partner' }, { model: 'crm.lead' }, { model: 'res.partner' }],
  });
  assert.deepEqual(names, ['crm.lead', 'res.partner']);
});

test('parseModelListResult drops rows without a string model', () => {
  const names = parseModelListResult({
    result: [{ model: 'account.move' }, { model: 42 }, { other: 'x' }, { model: '' }],
  });
  assert.deepEqual(names, ['account.move']);
});

test('parseModelListResult returns null on error / non-array / malformed', () => {
  assert.equal(parseModelListResult({ error: {} }), null);
  assert.equal(parseModelListResult({ result: 'nope' }), null);
  assert.equal(parseModelListResult(null), null);
});

test('parseModelListResult returns an empty array when no rows carry a model', () => {
  assert.deepEqual(parseModelListResult({ result: [] }), []);
});
