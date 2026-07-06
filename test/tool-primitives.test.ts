import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TOOL_PRIMITIVES,
  PRIMITIVE_EGRESS_ENV,
  WEB_SEARCH_ENV,
  getPrimitive,
  isEnvTruthy,
  isPrimitiveEnabled,
  primitiveCatalog,
  toolRef,
  isPrimitiveRef,
  parsePrimitiveRef,
} from '../src/lib/tool-primitives.ts';

// PURE unit tests for the tool-primitive catalog + air-gap gating (Builder Epic #117). No I/O.

test('catalog carries web_search / read_url / http_fetch, all internet-reaching + off by default', () => {
  const ids = TOOL_PRIMITIVES.map((p) => p.id).sort();
  assert.deepEqual(ids, ['http_fetch', 'read_url', 'web_search']);
  for (const p of TOOL_PRIMITIVES) {
    assert.equal(p.reachesInternet, true, `${p.id} reaches the internet`);
    assert.equal(p.defaultEnabled, false, `${p.id} is OFF by default (air-gap safe)`);
    assert.ok(p.enableEnv, `${p.id} declares an opt-in env flag`);
    assert.ok(p.airgapNote.length > 0);
  }
});

test('AIR-GAP: internet primitive is OFF with no env (default deployment)', () => {
  const ws = getPrimitive('web_search')!;
  assert.equal(isPrimitiveEnabled(ws, {}), false);
});

test('AIR-GAP: master egress flag opts in every internet primitive', () => {
  const env = { [PRIMITIVE_EGRESS_ENV]: 'true' };
  for (const p of TOOL_PRIMITIVES) assert.equal(isPrimitiveEnabled(p, env), true);
});

test('AIR-GAP: per-tool flag opts in only that primitive', () => {
  const env = { [WEB_SEARCH_ENV]: '1' };
  assert.equal(isPrimitiveEnabled(getPrimitive('web_search')!, env), true);
  assert.equal(isPrimitiveEnabled(getPrimitive('read_url')!, env), false);
});

test('isEnvTruthy accepts 1/true/yes/on (case-insensitive), rejects the rest', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'On']) assert.equal(isEnvTruthy(v), true, v);
  for (const v of ['0', 'false', '', undefined, 'nope']) assert.equal(isEnvTruthy(v as string), false, String(v));
});

test('an always-safe (non-internet) primitive would be enabled with no env', () => {
  const safe = { ...getPrimitive('web_search')!, reachesInternet: false };
  assert.equal(isPrimitiveEnabled(safe, {}), true);
});

test('ref helpers: prim:<id> round-trips', () => {
  const ref = toolRef('web_search');
  assert.equal(ref, 'prim:web_search');
  assert.equal(isPrimitiveRef(ref), true);
  assert.equal(isPrimitiveRef('tool:x'), false);
  assert.equal(parsePrimitiveRef(ref), 'web_search');
  assert.equal(parsePrimitiveRef('app:x'), null);
});

test('primitiveCatalog tags live enabled state from env', () => {
  const off = primitiveCatalog({});
  assert.ok(off.every((e) => e.enabled === false));
  const on = primitiveCatalog({ [PRIMITIVE_EGRESS_ENV]: 'yes' });
  assert.ok(on.every((e) => e.enabled === true));
  // still shows all primitives even when off (so the builder knows they exist)
  assert.equal(off.length, TOOL_PRIMITIVES.length);
});
