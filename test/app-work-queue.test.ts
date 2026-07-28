import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  arrivalSentence,
  buildAppWorkQueue,
  statusLabel,
  type WorkRun,
} from '../src/lib/app-work-queue.ts';

// The acceptance bar (docs/APP_AS_PRODUCT.md): a non-technical person in a department must understand
// this screen unaided, and the public demo is READ-ONLY so it has to be understandable by reading it.
// These tests assert the plain-language rules, not just the arithmetic.

const run = (over: Partial<WorkRun> & { id: string }): WorkRun => ({
  status: 'done',
  startedAt: '2026-07-20T10:00:00.000Z',
  ...over,
});

test('waiting cases lead, newest first, and are never truncated', () => {
  const q = buildAppWorkQueue({
    trigger: 'email',
    runs: [
      run({ id: 'a', status: 'awaiting_human', startedAt: '2026-07-01T00:00:00Z' }),
      run({ id: 'b', status: 'awaiting_human', startedAt: '2026-07-28T00:00:00Z' }),
      run({ id: 'c', status: 'awaiting_human', startedAt: '2026-07-14T00:00:00Z' }),
    ],
    recentLimit: 1,
  });
  // A queue that silently hides a case would let it sit unattended forever — the failure this screen
  // exists to prevent. recentLimit must never clip the waiting list.
  assert.deepEqual(
    q.waiting.map((r) => r.id),
    ['b', 'c', 'a'],
  );
});

test('finished cases are capped, waiting cases are not', () => {
  const runs = Array.from({ length: 20 }, (_, i) =>
    run({ id: `d${i}`, startedAt: `2026-07-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z` }),
  );
  const q = buildAppWorkQueue({ trigger: 'on-demand', runs, recentLimit: 5 });
  assert.equal(q.recent.length, 5);
  assert.equal(q.waiting.length, 0);
});

test('the headline states what is on the plate, in whole sentences', () => {
  const one = buildAppWorkQueue({
    trigger: 'email',
    runs: [run({ id: 'a', status: 'awaiting_human' })],
  });
  assert.equal(one.headline, '1 case is waiting for a person to decide.');

  const many = buildAppWorkQueue({
    trigger: 'email',
    runs: [
      run({ id: 'a', status: 'awaiting_human' }),
      run({ id: 'b', status: 'awaiting_human' }),
    ],
  });
  assert.equal(many.headline, '2 cases are waiting for a person to decide.');
});

test('nothing waiting reports the work already handled rather than looking dead', () => {
  const q = buildAppWorkQueue({
    trigger: 'email',
    runs: [run({ id: 'a' }), run({ id: 'b' }), run({ id: 'c' })],
  });
  assert.equal(q.headline, 'Nothing is waiting. 3 cases have been handled.');
  assert.equal(q.isEmpty, false);
});

test('a genuinely new app says so, and is flagged empty', () => {
  const q = buildAppWorkQueue({ trigger: 'on-demand', runs: [] });
  assert.equal(q.headline, 'No cases yet.');
  assert.equal(q.isEmpty, true);
});

test('an app with only in-flight runs is NOT empty — it is working', () => {
  // queued/running is activity. Calling it empty would show a first-run explanation over a live app.
  const q = buildAppWorkQueue({
    trigger: 'webhook',
    runs: [run({ id: 'a', status: 'running' }), run({ id: 'b', status: 'queued' })],
  });
  assert.equal(q.isEmpty, false);
  assert.equal(q.waiting.length, 0);
  assert.equal(q.recent.length, 0);
});

test('error and cancelled runs count as finished, not as waiting', () => {
  const q = buildAppWorkQueue({
    trigger: 'email',
    runs: [run({ id: 'a', status: 'error' }), run({ id: 'b', status: 'cancelled' })],
  });
  assert.equal(q.waiting.length, 0);
  assert.equal(q.recent.length, 2);
});

test('arrival is explained without technical vocabulary', () => {
  assert.match(arrivalSentence('email'), /arrive by email/i);
  assert.match(arrivalSentence('whatsapp'), /arrive by WhatsApp/i);
  assert.match(arrivalSentence('schedule'), /set schedule/i);
  assert.match(arrivalSentence('on-demand'), /somebody starts/i);
  // "webhook" must never reach the reader — they are told work arrives from a connected system.
  const webhook = arrivalSentence('webhook');
  assert.doesNotMatch(webhook, /webhook|http|endpoint|POST/i);
  assert.match(webhook, /connected system/i);
});

test('an unknown trigger never claims work arrives automatically', () => {
  // Overstating automation would have someone waiting for cases that never come.
  const unknown = arrivalSentence('telegram-someday');
  assert.doesNotMatch(unknown, /automatically/i);
  assert.match(unknown, /started from this screen/i);
});

test('status labels read as plain English, never as machine states', () => {
  assert.equal(statusLabel('awaiting_human'), 'Waiting for you');
  assert.equal(statusLabel('running'), 'Working on it');
  assert.equal(statusLabel('done'), 'Completed');
  assert.equal(statusLabel('error'), 'Could not finish');
  for (const s of ['awaiting_human', 'running', 'done', 'error']) {
    assert.doesNotMatch(statusLabel(s), /_/, 'no snake_case may reach the reader');
  }
});

test('unparseable timestamps sort last instead of throwing', () => {
  const q = buildAppWorkQueue({
    trigger: 'email',
    runs: [
      run({ id: 'bad', status: 'awaiting_human', startedAt: 'not-a-date' }),
      run({ id: 'good', status: 'awaiting_human', startedAt: '2026-07-28T00:00:00Z' }),
    ],
  });
  assert.deepEqual(
    q.waiting.map((r) => r.id),
    ['good', 'bad'],
  );
});
