import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  statusLabel,
  statusTone,
  isTerminal,
  shouldPoll,
  awaitingStep,
  canReview,
  progress,
  priorContextForReview,
  describeDuration,
  toAppRunView,
  type AppRunStepRow,
} from '../src/lib/app-runs-view.ts';

// Unit tests for the PURE app-runs view logic — no mocks, no I/O (the read helpers query the DB and
// are exercised by integration wiring, not here). Covers the exact rules screens 3 (RUNNING) and 4
// (REVIEW) render: status→label/tone, terminal/poll, which step is awaiting, can-review predicate,
// progress, prior-context slicing, duration, and the row→view mapper.

const step = (over: Partial<AppRunStepRow> = {}): AppRunStepRow => ({
  id: 's1',
  kind: 'agent',
  label: 'Step',
  status: 'queued',
  ...over,
});

test('statusLabel: known statuses → operator labels; unknown → raw', () => {
  assert.equal(statusLabel('awaiting_human'), 'Awaiting review');
  assert.equal(statusLabel('done'), 'Done');
  assert.equal(statusLabel('error'), 'Failed');
  assert.equal(statusLabel('weird'), 'weird');
});

test('statusTone: maps each status to a tone; unknown → neutral', () => {
  assert.equal(statusTone('running'), 'active');
  assert.equal(statusTone('awaiting_human'), 'warn');
  assert.equal(statusTone('done'), 'success');
  assert.equal(statusTone('error'), 'error');
  assert.equal(statusTone('queued'), 'neutral');
  assert.equal(statusTone('nope'), 'neutral');
});

test('isTerminal / shouldPoll: live runs poll, terminal runs stop', () => {
  for (const s of ['queued', 'running', 'awaiting_human']) {
    assert.equal(isTerminal(s), false, s);
    assert.equal(shouldPoll(s), true, s);
  }
  for (const s of ['done', 'error', 'cancelled']) {
    assert.equal(isTerminal(s), true, s);
    assert.equal(shouldPoll(s), false, s);
  }
});

test('awaitingStep: returns the first awaiting_human step, else null', () => {
  assert.equal(awaitingStep([step({ status: 'done' }), step({ status: 'running' })]), null);
  const found = awaitingStep([
    step({ id: 'a', status: 'done' }),
    step({ id: 'b', status: 'awaiting_human', kind: 'human' }),
    step({ id: 'c', status: 'queued' }),
  ]);
  assert.equal(found?.id, 'b');
});

test('canReview: true only when paused at a human step', () => {
  assert.equal(
    canReview({ status: 'awaiting_human', steps: [step({ status: 'awaiting_human', kind: 'human' })] }),
    true,
  );
  // terminal run — not reviewable even if a stale awaiting step exists
  assert.equal(
    canReview({ status: 'done', steps: [step({ status: 'awaiting_human' })] }),
    false,
  );
  // running run with no awaiting step — not reviewable
  assert.equal(canReview({ status: 'running', steps: [step({ status: 'running' })] }), false);
});

test('progress: counts done+skipped over total', () => {
  const p = progress([
    step({ status: 'done' }),
    step({ status: 'skipped' }),
    step({ status: 'running' }),
    step({ status: 'queued' }),
  ]);
  assert.deepEqual(p, { done: 2, total: 4 });
});

test('priorContextForReview: everything before the awaiting step', () => {
  const steps = [
    step({ id: 'a', status: 'done' }),
    step({ id: 'b', status: 'done' }),
    step({ id: 'c', status: 'awaiting_human', kind: 'human' }),
    step({ id: 'd', status: 'queued' }),
  ];
  assert.deepEqual(priorContextForReview(steps).map((s) => s.id), ['a', 'b']);
  // no awaiting step → empty
  assert.deepEqual(priorContextForReview([step({ status: 'done' })]), []);
});

test('describeDuration: ms / seconds / dash', () => {
  assert.equal(describeDuration('2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.340Z'), '340ms');
  assert.equal(describeDuration('2026-07-01T00:00:00.000Z', '2026-07-01T00:00:01.500Z'), '1.5s');
  assert.equal(describeDuration(undefined, '2026-07-01T00:00:01.500Z'), '—');
  assert.equal(describeDuration('2026-07-01T00:00:01.500Z', '2026-07-01T00:00:00.000Z'), '—');
});

test('toAppRunView: maps a row into the serializable view, defaulting nulls', () => {
  const view = toAppRunView({
    id: 'r1',
    orgId: 'default',
    appId: 'app_1',
    status: 'awaiting_human',
    trigger: { kind: 'on-demand' },
    input: { q: 'hi' },
    steps: [{ id: 's1', kind: 'human', label: 'Approve', status: 'awaiting_human' }],
    outcome: 'partial',
    provenance: null,
    startedAt: new Date('2026-07-01T00:00:00.000Z'),
    finishedAt: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert.equal(view.id, 'r1');
  assert.equal(view.appId, 'app_1');
  assert.equal(view.status, 'awaiting_human');
  assert.deepEqual(view.input, { q: 'hi' });
  assert.equal(view.steps.length, 1);
  assert.equal(view.outcome, 'partial');
  assert.equal(view.startedAt, '2026-07-01T00:00:00.000Z');
  assert.equal(view.finishedAt, null);
});
