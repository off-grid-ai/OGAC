import assert from 'node:assert/strict';
import { test } from 'node:test';
import { degradeMessage, degradeOn503 } from '../src/lib/route-degrade.ts';

// Unit tests for the P2 #129 graceful-degradation route wrapper. `degradeMessage` is the pure,
// zero-IO error→message mapping; `degradeOn503` is the thin wrapper that must (a) pass the happy
// path through untouched and (b) turn any thrown dependency error into a 503 {error} envelope —
// the shape the rest of the API returns, instead of Next's opaque 500. Real functions, no mocks.

test('degradeMessage: Error message is surfaced', () => {
  assert.equal(degradeMessage(new Error('ECONNREFUSED')), 'ECONNREFUSED');
});

test('degradeMessage: plain string passes through', () => {
  assert.equal(degradeMessage('boom'), 'boom');
});

test('degradeMessage: opaque / empty values fall back to a stable message', () => {
  assert.equal(degradeMessage(new Error('')), 'service unavailable');
  assert.equal(degradeMessage(undefined), 'service unavailable');
  assert.equal(degradeMessage({}), 'service unavailable');
});

test('degradeOn503: happy path returns the body Response untouched', async () => {
  const ok = Response.json({ data: [1, 2, 3] }, { status: 200 });
  const res = await degradeOn503(async () => ok);
  assert.equal(res, ok);
  assert.equal(res.status, 200);
});

test('degradeOn503: a thrown dependency error becomes 503 {error}', async () => {
  const res = await degradeOn503(async () => {
    throw new Error('Postgres unreachable');
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.deepEqual(body, { error: 'Postgres unreachable' });
});

test('degradeOn503: a non-Error throw still yields a clean 503', async () => {
  const res = await degradeOn503(async () => {
    throw 'raw string failure';
  });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'raw string failure' });
});
