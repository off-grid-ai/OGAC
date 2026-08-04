import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PERSIST_ATTEMPTS,
  describePersistFailure,
  isTerminalStatus,
  persistBackoffMs,
} from '../src/lib/persist-retry.ts';

test('backoff grows and then stops, so a slow database cannot stall a run forever', () => {
  const waits: (number | null)[] = [];
  for (let a = 1; a <= MAX_PERSIST_ATTEMPTS + 1; a++) waits.push(persistBackoffMs(a));
  // One wait per retry, and null once the attempts are spent.
  assert.equal(waits.filter((w) => w !== null).length, MAX_PERSIST_ATTEMPTS - 1);
  assert.equal(waits[MAX_PERSIST_ATTEMPTS - 1], null);
  const real = waits.filter((w): w is number => w !== null);
  for (let i = 1; i < real.length; i++) assert.ok(real[i] > real[i - 1], 'each wait must be longer');
  // And bounded: the whole sequence must not add up to something that blocks a run noticeably.
  assert.ok(
    real.reduce((a, b) => a + b, 0) < 1000,
    `total backoff ${real.reduce((a, b) => a + b, 0)}ms should stay under a second`,
  );
});

test('the failure line carries the run id — without it the alarm is unactionable', () => {
  const line = describePersistFailure({
    runId: 'apprun_abc123',
    orgId: 'org_bharat',
    attempts: 3,
    status: 'done',
    error: new Error('connection terminated'),
  });
  assert.match(line, /APP_RUN_PERSIST_FAILED/);
  assert.match(line, /run=apprun_abc123/);
  assert.match(line, /org=org_bharat/);
  assert.match(line, /attempts=3/);
  assert.match(line, /connection terminated/);
});

test('a database error CAUSE is surfaced, not just its generic message', () => {
  // Drizzle wraps the real reason in `cause` — a bare message reads "Failed query" and diagnoses nothing.
  const err = new Error('Failed query: insert into app_runs');
  (err as unknown as { cause: { code: string } }).cause = { code: 'ECONNREFUSED' };
  assert.match(describePersistFailure({ runId: 'r1', orgId: 'o', attempts: 3, error: err }), /ECONNREFUSED/);
});

test('a non-Error thrown value is still reported rather than becoming "undefined"', () => {
  assert.match(
    describePersistFailure({ runId: 'r1', orgId: 'o', attempts: 3, error: 'socket hang up' }),
    /socket hang up/,
  );
});

test('terminal runs are distinguished — a lost write there is permanent', () => {
  for (const s of ['done', 'error', 'cancelled']) assert.equal(isTerminalStatus(s), true, s);
  for (const s of ['running', 'queued', 'awaiting_human', undefined]) {
    assert.equal(isTerminalStatus(s), false, String(s));
  }
});
