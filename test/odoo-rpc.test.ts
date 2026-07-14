import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAuthPayload,
  buildModelListPayload,
  buildSearchReadPayload,
  parseAuthResult,
  parseModelListResult,
  parseOdooCredentials,
  parseOdooEndpoint,
  parseSearchReadResult,
} from '@/lib/odoo-rpc';

// UNIT tests for the PURE Odoo JSON-RPC shaping module. No I/O — every function is a total transform.
// The contract under test: build the EXACT wire bodies Odoo expects, and parse its responses,
// returning null on anything malformed/error so the I/O layer degrades honestly (never fabricates).

// ─── parseOdooEndpoint ──────────────────────────────────────────────────────────────────────────
test('parseOdooEndpoint parses the odoo:// scheme form (db from path, http base, no userinfo)', () => {
  assert.deepEqual(parseOdooEndpoint('odoo://admin:secret@erp.internal:8069/bharatunion'), {
    base: 'http://erp.internal:8069',
    db: 'bharatunion',
  });
});

test('parseOdooEndpoint parses the https ?db= form', () => {
  assert.deepEqual(parseOdooEndpoint('https://erp.example.com/odoo?db=PROD'), {
    base: 'https://erp.example.com',
    db: 'PROD',
  });
});

test('parseOdooEndpoint infers https from port 443 on the odoo:// scheme and drops the redundant :443', () => {
  assert.deepEqual(parseOdooEndpoint('odoo://u:p@erp.example.com:443/DB'), {
    base: 'https://erp.example.com',
    db: 'DB',
  });
});

test('parseOdooEndpoint infers https from an ?ssl=1 hint on odoo:// and keeps a non-443 port', () => {
  assert.deepEqual(parseOdooEndpoint('odoo://u:p@erp.example.com:8443/DB?ssl=1'), {
    base: 'https://erp.example.com:8443',
    db: 'DB',
  });
  assert.deepEqual(parseOdooEndpoint('odoo://erp.example.com/DB?ssl=true'), {
    base: 'https://erp.example.com',
    db: 'DB',
  });
});

test('parseOdooEndpoint prefers ?db= over a path segment', () => {
  assert.deepEqual(parseOdooEndpoint('https://host/odoo/IGNORED?db=REAL'), {
    base: 'https://host',
    db: 'REAL',
  });
});

test('parseOdooEndpoint skips the odoo/jsonrpc path segments when picking the db', () => {
  assert.deepEqual(parseOdooEndpoint('http://host:8069/odoo/BANKDB'), {
    base: 'http://host:8069',
    db: 'BANKDB',
  });
});

test('parseOdooEndpoint keeps an explicit http port', () => {
  assert.deepEqual(parseOdooEndpoint('odoo://host:8069/DB'), {
    base: 'http://host:8069',
    db: 'DB',
  });
});

test('parseOdooEndpoint returns null when no db can be determined', () => {
  assert.equal(parseOdooEndpoint('odoo://admin:secret@erp.internal:8069'), null);
  assert.equal(parseOdooEndpoint('https://host/odoo'), null);
  assert.equal(parseOdooEndpoint('https://host'), null);
});

test('parseOdooEndpoint returns null for unparseable / empty input', () => {
  assert.equal(parseOdooEndpoint('not a url'), null);
  assert.equal(parseOdooEndpoint(''), null);
  assert.equal(parseOdooEndpoint('   '), null);
  assert.equal(parseOdooEndpoint(undefined), null);
  assert.equal(parseOdooEndpoint(null), null);
});

// ─── parseOdooCredentials ──────────────────────────────────────────────────────────────────────
test('parseOdooCredentials pulls url-decoded login/password from userinfo', () => {
  assert.deepEqual(parseOdooCredentials('odoo://ad%40min:se%2Fcret@host/DB'), {
    login: 'ad@min',
    password: 'se/cret',
  });
});

test('parseOdooCredentials returns empty strings when userinfo is absent or input is bad', () => {
  assert.deepEqual(parseOdooCredentials('https://host/odoo?db=X'), { login: '', password: '' });
  assert.deepEqual(parseOdooCredentials('nonsense'), { login: '', password: '' });
  assert.deepEqual(parseOdooCredentials(''), { login: '', password: '' });
  assert.deepEqual(parseOdooCredentials(null), { login: '', password: '' });
});

// ─── buildAuthPayload ─────────────────────────────────────────────────────────────────────────
test('buildAuthPayload produces the exact common.authenticate body', () => {
  assert.deepEqual(buildAuthPayload('bharatunion', 'admin', 'secret'), {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'common',
      method: 'authenticate',
      args: ['bharatunion', 'admin', 'secret', {}],
    },
    id: 1,
  });
});

// ─── buildSearchReadPayload ─────────────────────────────────────────────────────────────────────
test('buildSearchReadPayload produces the exact object.execute_kw/search_read body with defaults', () => {
  assert.deepEqual(buildSearchReadPayload('DB', 7, 'pw', 'res.partner'), {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args: ['DB', 7, 'pw', 'res.partner', 'search_read', [[]], { fields: [], limit: 100, offset: 0 }],
    },
    id: 1,
  });
});

test('buildSearchReadPayload carries domain, fields, limit and offset through', () => {
  const body = buildSearchReadPayload('DB', 7, 'pw', 'crm.lead', {
    domain: [['stage_id', '=', 1]],
    fields: ['name', 'expected_revenue'],
    limit: 25,
    offset: 50,
  });
  assert.deepEqual(body.params.args, [
    'DB',
    7,
    'pw',
    'crm.lead',
    'search_read',
    [[['stage_id', '=', 1]]],
    { fields: ['name', 'expected_revenue'], limit: 25, offset: 50 },
  ]);
});

test('buildSearchReadPayload clamps limit to [1,1000] and floors offset at 0', () => {
  const kwHigh = buildSearchReadPayload('DB', 1, 'pw', 'm', { limit: 99999, offset: -5 })
    .params.args[6] as { limit: number; offset: number };
  assert.equal(kwHigh.limit, 1000);
  assert.equal(kwHigh.offset, 0);
  const kwLow = buildSearchReadPayload('DB', 1, 'pw', 'm', { limit: 0 }).params.args[6] as {
    limit: number;
  };
  assert.equal(kwLow.limit, 1);
});

test('buildSearchReadPayload ignores non-array domain/fields defensively', () => {
  const body = buildSearchReadPayload('DB', 1, 'pw', 'm', {
    // @ts-expect-error — exercising the runtime guard with a wrong type
    domain: 'oops',
    // @ts-expect-error — exercising the runtime guard with a wrong type
    fields: 'nope',
  });
  const [, , , , , domainArg, kw] = body.params.args as [
    string,
    number,
    string,
    string,
    string,
    unknown[],
    { fields: unknown[] },
  ];
  assert.deepEqual(domainArg, [[]]);
  assert.deepEqual(kw.fields, []);
});

// ─── buildModelListPayload ─────────────────────────────────────────────────────────────────────
test('buildModelListPayload reads ir.model with the model+name fields', () => {
  const body = buildModelListPayload('DB', 2, 'pw');
  assert.deepEqual(body.params.args, [
    'DB',
    2,
    'pw',
    'ir.model',
    'search_read',
    [[]],
    { fields: ['model', 'name'], limit: 1000, offset: 0 },
  ]);
});

// ─── parseAuthResult ──────────────────────────────────────────────────────────────────────────
test('parseAuthResult returns the uid on success', () => {
  assert.equal(parseAuthResult({ jsonrpc: '2.0', id: 1, result: 7 }), 7);
});

test('parseAuthResult returns null for bad credentials (result:false), zero, and negatives', () => {
  assert.equal(parseAuthResult({ jsonrpc: '2.0', id: 1, result: false }), null);
  assert.equal(parseAuthResult({ result: 0 }), null);
  assert.equal(parseAuthResult({ result: -3 }), null);
  assert.equal(parseAuthResult({ result: 1.5 }), null);
});

test('parseAuthResult returns null on error bodies and malformed input', () => {
  assert.equal(parseAuthResult({ jsonrpc: '2.0', id: 1, error: { message: 'no db' } }), null);
  assert.equal(parseAuthResult({ jsonrpc: '2.0', id: 1 }), null); // no result key
  assert.equal(parseAuthResult(null), null);
  assert.equal(parseAuthResult('not json'), null);
  assert.equal(parseAuthResult([1, 2, 3]), null);
  assert.equal(parseAuthResult(undefined), null);
});

// ─── parseSearchReadResult ──────────────────────────────────────────────────────────────────────
test('parseSearchReadResult returns the record array on success', () => {
  const body = { jsonrpc: '2.0', id: 1, result: [{ id: 1, name: 'Ravi' }, { id: 2, name: 'Priya' }] };
  assert.deepEqual(parseSearchReadResult(body), [
    { id: 1, name: 'Ravi' },
    { id: 2, name: 'Priya' },
  ]);
});

test('parseSearchReadResult drops non-object entries defensively and returns [] for an empty result', () => {
  assert.deepEqual(parseSearchReadResult({ result: [{ id: 1 }, 5, null, 'x', { id: 2 }] }), [
    { id: 1 },
    { id: 2 },
  ]);
  assert.deepEqual(parseSearchReadResult({ result: [] }), []);
});

test('parseSearchReadResult returns null for a non-array result, error body, and malformed input', () => {
  assert.equal(parseSearchReadResult({ result: false }), null);
  assert.equal(parseSearchReadResult({ result: { not: 'an array' } }), null);
  assert.equal(parseSearchReadResult({ error: { message: 'boom' } }), null);
  assert.equal(parseSearchReadResult({}), null);
  assert.equal(parseSearchReadResult(null), null);
  assert.equal(parseSearchReadResult(42), null);
});

// ─── parseModelListResult ──────────────────────────────────────────────────────────────────────
test('parseModelListResult extracts the technical model names', () => {
  const body = {
    result: [
      { id: 1, model: 'res.partner', name: 'Contact' },
      { id: 2, model: 'crm.lead', name: 'Lead' },
    ],
  };
  assert.deepEqual(parseModelListResult(body), ['res.partner', 'crm.lead']);
});

test('parseModelListResult filters out rows without a usable model string', () => {
  const body = { result: [{ model: 'res.partner' }, { model: '' }, { model: 42 }, { name: 'x' }] };
  assert.deepEqual(parseModelListResult(body), ['res.partner']);
});

test('parseModelListResult returns null when the underlying result is a miss', () => {
  assert.equal(parseModelListResult({ error: { message: 'x' } }), null);
  assert.equal(parseModelListResult({ result: false }), null);
  assert.equal(parseModelListResult(null), null);
});
