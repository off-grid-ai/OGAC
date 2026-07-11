import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeWithTimeout, withTimeout } from '../src/lib/with-timeout.ts';

// withTimeout is the wall-clock cap that keeps a slow/unreachable backend from stalling a
// force-dynamic RSC render. The load-bearing properties: a fast value passes through untouched; a
// slow probe yields the fallback at the deadline (never blocks past it); a rejecting probe degrades
// to the same fallback (so callers need no try/catch); and it never rejects (safe inside Promise.all).

const later = <T>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const rejectLater = (ms: number) =>
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error('probe failed')), ms));

test('resolves the real value when the promise settles before the timeout', async () => {
  const out = await withTimeout(later('live', 5), 1000, 'fallback');
  assert.equal(out, 'live');
});

test('resolves the fallback when the promise is slower than the timeout', async () => {
  const start = Date.now();
  const out = await withTimeout(later('live', 1000), 30, 'fallback');
  const elapsed = Date.now() - start;
  assert.equal(out, 'fallback');
  // It must return at ~the deadline, not wait for the slow promise (well under its 1000ms).
  assert.ok(elapsed < 300, `expected to return near the 30ms deadline, took ${elapsed}ms`);
});

test('resolves the fallback (never rejects) when the promise rejects before the timeout', async () => {
  const out = await withTimeout(rejectLater(5), 1000, 'fallback');
  assert.equal(out, 'fallback');
});

test('a late rejection after the deadline cannot flip an already-resolved fallback', async () => {
  // Guards the settled-latch: the timeout fires first (fallback), then the promise rejects later.
  // An unhandled flip here would crash the process; the test passing proves the latch holds.
  const out = await withTimeout(rejectLater(50), 10, 'fallback');
  assert.equal(out, 'fallback');
  await new Promise((r) => setTimeout(r, 80)); // let the late rejection land — must be swallowed
});

test('invokes onTimeout exactly once, and only on the timeout path', async () => {
  let timeouts = 0;
  const opts = { onTimeout: () => { timeouts += 1; } };
  await withTimeout(later('fast', 5), 1000, 'fallback', opts);
  assert.equal(timeouts, 0, 'onTimeout must not fire when the value wins');
  await withTimeout(later('slow', 1000), 10, 'fallback', opts);
  assert.equal(timeouts, 1, 'onTimeout fires once when the deadline wins');
});

test('composes inside Promise.all — one slow probe degrades to fallback, others pass', async () => {
  const [a, b, c] = await Promise.all([
    withTimeout(later('A', 5), 500, 'A-fallback'),
    withTimeout(later('B', 1000), 20, 'B-fallback'), // too slow → fallback
    withTimeout(rejectLater(5), 500, 'C-fallback'), // rejects → fallback
  ]);
  assert.deepEqual([a, b, c], ['A', 'B-fallback', 'C-fallback']);
});

test('safeWithTimeout: passes a fast thunk value through', async () => {
  const out = await safeWithTimeout(() => later('ok', 5), 1000, 'fallback');
  assert.equal(out, 'ok');
});

test('safeWithTimeout: a synchronous throw while building the promise degrades to the fallback', async () => {
  const out = await safeWithTimeout(() => {
    throw new Error('boom before any await');
  }, 1000, 'fallback');
  assert.equal(out, 'fallback');
});

test('safeWithTimeout: a slow thunk degrades to the fallback at the deadline', async () => {
  const out = await safeWithTimeout(() => later('slow', 1000), 20, 'fallback');
  assert.equal(out, 'fallback');
});

test('safeWithTimeout: a thunk whose promise rejects before the deadline degrades to the fallback', async () => {
  const out = await safeWithTimeout(() => rejectLater(5), 1000, 'fallback');
  assert.equal(out, 'fallback');
});
