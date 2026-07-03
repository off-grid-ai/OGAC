import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  API_CATALOG,
  allEndpoints,
  playgroundEndpoints,
} from '../src/lib/api-catalog.ts';

// Unit tests for the API catalog — the single source of truth for the docs module. Pure data, NO
// mocks. Guards the invariants the page/playground rely on so a bad entry is caught here.

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_LEVELS = new Set(['public', 'user', 'admin']);

test('catalog is non-empty and every area has endpoints', () => {
  assert.ok(API_CATALOG.length > 0);
  for (const area of API_CATALOG) {
    assert.equal(typeof area.area, 'string');
    assert.ok(area.area.length > 0);
    assert.equal(typeof area.description, 'string');
    assert.ok(area.description.length > 0);
    assert.ok(area.endpoints.length > 0, `area ${area.area} has no endpoints`);
  }
});

test('area names are unique', () => {
  const names = API_CATALOG.map((a) => a.area);
  assert.equal(new Set(names).size, names.length);
});

test('every endpoint has valid required fields', () => {
  for (const e of allEndpoints()) {
    assert.ok(HTTP_METHODS.has(e.method), `bad method ${e.method} on ${e.path}`);
    assert.ok(AUTH_LEVELS.has(e.auth), `bad auth ${e.auth} on ${e.path}`);
    assert.ok(e.path.startsWith('/api/'), `path must start with /api/: ${e.path}`);
    assert.equal(typeof e.summary, 'string');
    assert.ok(e.summary.length > 0, `empty summary on ${e.path}`);
  }
});

test('params, when present, are well-formed', () => {
  const validIn = new Set(['path', 'query', 'body']);
  for (const e of allEndpoints()) {
    if (!e.params) continue;
    for (const p of e.params) {
      assert.ok(p.name.length > 0);
      assert.ok(validIn.has(p.in), `bad param.in ${p.in} on ${e.path}`);
    }
  }
});

test('method+path pairs are unique across the catalog', () => {
  const keys = allEndpoints().map((e) => `${e.method} ${e.path}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('playground endpoints are exactly the safe unauthenticated GETs', () => {
  const pg = playgroundEndpoints();
  assert.ok(pg.length > 0, 'expected at least one safe GET for the playground');
  for (const e of pg) {
    assert.equal(e.method, 'GET');
    assert.equal(e.safeGet, true);
    assert.equal(e.auth, 'public', `safe playground GET must be public: ${e.path}`);
  }
  // Nothing mutating or authenticated ever leaks into the playground set.
  const leaked = allEndpoints().filter(
    (e) => e.safeGet === true && (e.method !== 'GET' || e.auth !== 'public'),
  );
  assert.equal(leaked.length, 0);
});
