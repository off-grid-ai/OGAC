import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  shapeQueueReadiness,
  summarizeWorkerReadiness,
  type QueueReadiness,
} from '../src/lib/task-queue-readiness.ts';

// PURE unit tests for the Temporal task-queue readiness contract — no cluster, no network. They pin
// the verdict that `temporal:worker-readiness` depends on: a queue is READY only when a live,
// identified poller is attached; everything else (unreachable / unconfigured / zero pollers) is a
// distinct, non-ready state. Real function, no mocks.

// ─── shapeQueueReadiness: the four resolution states ──────────────────────────

test('ready when at least one identified poller is attached', () => {
  const r = shapeQueueReadiness('offgrid-apps', {
    pollers: [{ identity: '42701@offgrid-s1', lastAccessTime: '2026-07-20T17:00:00.000Z', ratePerSecond: 1.5 }],
  });
  assert.equal(r.status, 'ready');
  assert.equal(r.pollerCount, 1);
  assert.equal(r.pollers[0].identity, '42701@offgrid-s1');
  assert.equal(r.pollers[0].lastAccessTime, '2026-07-20T17:00:00.000Z');
  assert.equal(r.pollers[0].ratePerSecond, 1.5);
  assert.match(r.note, /1 compatible poller: 42701@offgrid-s1/);
});

test('plural note and multiple pollers', () => {
  const r = shapeQueueReadiness('offgrid-agents', {
    pollers: [{ identity: 'a@h' }, { identity: 'b@h' }],
  });
  assert.equal(r.pollerCount, 2);
  assert.match(r.note, /2 compatible pollers: a@h, b@h/);
});

test('no-pollers when the queue exists but nothing is draining it', () => {
  const r = shapeQueueReadiness('offgrid-chat', { pollers: [] });
  assert.equal(r.status, 'no-pollers');
  assert.equal(r.pollerCount, 0);
  assert.match(r.note, /no compatible poller/);
});

test('missing pollers array is treated as zero pollers', () => {
  const r = shapeQueueReadiness('q', {});
  assert.equal(r.status, 'no-pollers');
  assert.equal(r.pollerCount, 0);
});

test('unreachable when configured but the probe returned null', () => {
  const r = shapeQueueReadiness('offgrid-apps', null, { configured: true });
  assert.equal(r.status, 'unreachable');
  assert.equal(r.pollerCount, 0);
  assert.match(r.note, /unreachable/i);
});

test('not-configured when the durable path is off', () => {
  const r = shapeQueueReadiness('offgrid-apps', null, { configured: false });
  assert.equal(r.status, 'not-configured');
  assert.match(r.note, /not configured/i);
});

test('custom note overrides the default on a null read', () => {
  const r = shapeQueueReadiness('q', null, { configured: true, note: 'auth denied' });
  assert.equal(r.note, 'auth denied');
});

test('defaults to configured=true when opts omitted', () => {
  const r = shapeQueueReadiness('q', null);
  assert.equal(r.status, 'unreachable');
});

// ─── normalization edge cases ─────────────────────────────────────────────────

test('a Date lastAccessTime is normalized to ISO', () => {
  const d = new Date('2026-01-02T03:04:05.000Z');
  const r = shapeQueueReadiness('q', { pollers: [{ identity: 'x', lastAccessTime: d }] });
  assert.equal(r.pollers[0].lastAccessTime, '2026-01-02T03:04:05.000Z');
});

test('a numeric epoch lastAccessTime is normalized to ISO', () => {
  const r = shapeQueueReadiness('q', {
    pollers: [{ identity: 'x', lastAccessTime: Date.parse('2026-01-02T03:04:05.000Z') }],
  });
  assert.equal(r.pollers[0].lastAccessTime, '2026-01-02T03:04:05.000Z');
});

test('an invalid Date lastAccessTime becomes null', () => {
  const r = shapeQueueReadiness('q', { pollers: [{ identity: 'x', lastAccessTime: new Date('nope') }] });
  assert.equal(r.pollers[0].lastAccessTime, null);
});

test('an invalid numeric lastAccessTime becomes null', () => {
  const r = shapeQueueReadiness('q', { pollers: [{ identity: 'x', lastAccessTime: Number.NaN }] });
  assert.equal(r.pollers[0].lastAccessTime, null);
});

test('an empty-string lastAccessTime becomes null', () => {
  const r = shapeQueueReadiness('q', { pollers: [{ identity: 'x', lastAccessTime: '   ' }] });
  assert.equal(r.pollers[0].lastAccessTime, null);
});

test('null lastAccessTime and non-finite rate become null', () => {
  const r = shapeQueueReadiness('q', {
    pollers: [{ identity: 'x', lastAccessTime: null, ratePerSecond: Infinity }],
  });
  assert.equal(r.pollers[0].lastAccessTime, null);
  assert.equal(r.pollers[0].ratePerSecond, null);
});

test('pollers without an identity are dropped as unusable evidence', () => {
  const r = shapeQueueReadiness('q', {
    pollers: [{ identity: '   ' }, { identity: undefined }, { identity: 'real@h' }],
  });
  assert.equal(r.pollerCount, 1);
  assert.equal(r.pollers[0].identity, 'real@h');
});

test('blank queue name falls back to "unknown"', () => {
  const r = shapeQueueReadiness('   ', { pollers: [{ identity: 'x' }] });
  assert.equal(r.queue, 'unknown');
});

// ─── backlog handling ─────────────────────────────────────────────────────────

test('valid backlog count is surfaced and noted', () => {
  const r = shapeQueueReadiness('q', { pollers: [{ identity: 'x' }], backlogCount: 7 });
  assert.equal(r.backlogCount, 7);
  assert.match(r.note, /Backlog 7\./);
});

test('backlog count is floored and negatives rejected', () => {
  assert.equal(shapeQueueReadiness('q', { pollers: [{ identity: 'x' }], backlogCount: 3.9 }).backlogCount, 3);
  assert.equal(shapeQueueReadiness('q', { pollers: [{ identity: 'x' }], backlogCount: -1 }).backlogCount, null);
});

test('unknown backlog adds no backlog note', () => {
  const r = shapeQueueReadiness('q', { pollers: [{ identity: 'x' }] });
  assert.equal(r.backlogCount, null);
  assert.doesNotMatch(r.note, /Backlog/);
});

test('backlog is noted even on a no-pollers queue', () => {
  const r = shapeQueueReadiness('q', { pollers: [], backlogCount: 4 });
  assert.equal(r.status, 'no-pollers');
  assert.match(r.note, /Backlog 4\./);
});

// ─── summarizeWorkerReadiness ─────────────────────────────────────────────────

const ready = (q: string): QueueReadiness => shapeQueueReadiness(q, { pollers: [{ identity: 'p@h' }] });
const down = (q: string): QueueReadiness => shapeQueueReadiness(q, { pollers: [] });

test('allReady only when every queue is ready', () => {
  const s = summarizeWorkerReadiness([ready('a'), ready('b'), ready('c')]);
  assert.equal(s.allReady, true);
  assert.equal(s.readyCount, 3);
  assert.equal(s.totalCount, 3);
});

test('not allReady when any queue is not ready', () => {
  const s = summarizeWorkerReadiness([ready('a'), down('b')]);
  assert.equal(s.allReady, false);
  assert.equal(s.readyCount, 1);
  assert.equal(s.totalCount, 2);
});

test('empty queue set is not allReady', () => {
  const s = summarizeWorkerReadiness([]);
  assert.equal(s.allReady, false);
  assert.equal(s.readyCount, 0);
  assert.equal(s.totalCount, 0);
});
