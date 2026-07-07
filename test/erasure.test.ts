import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ERASURE_CATALOG,
  DEFERRED_STORES,
  planErasure,
  summarizeErasure,
  type StepResult,
} from '../src/lib/erasure.ts';

// PURE unit tests for the DSAR / right-to-erasure planner — no DB, no mocks. The plan is the
// auditable artifact; the route executes it. These lock what erasure WILL touch and how it reports.

test('planErasure: one step per catalog target, subject bound as the match value', () => {
  const plan = planErasure('alice@corp.in');
  assert.equal(plan.subject, 'alice@corp.in');
  assert.equal(plan.steps.length, ERASURE_CATALOG.length);
  for (const step of plan.steps) {
    assert.equal(step.value, 'alice@corp.in'); // email-match targets bind the subject verbatim
    assert.ok(step.table && step.column && step.store);
  }
  // The known subject-bearing tables are covered.
  const tables = plan.steps.map((s) => s.table);
  assert.ok(tables.includes('chat_messages'));
  assert.ok(tables.includes('api_keys'));
  assert.ok(tables.includes('audit_events'));
});

test('planErasure: dependent rows (messages) are ordered before their parents (conversations)', () => {
  const plan = planErasure('bob@corp.in');
  const msgIdx = plan.steps.findIndex((s) => s.table === 'chat_messages');
  const convIdx = plan.steps.findIndex((s) => s.table === 'chat_conversations');
  assert.ok(msgIdx >= 0 && convIdx >= 0);
  assert.ok(msgIdx < convIdx, 'messages must be deleted before conversations');
});

test('planErasure: actorPrefixed targets prefix the subject with actor:', () => {
  const plan = planErasure('carol@corp.in', [
    { store: 'Legacy audit', table: 'audit_events', column: 'device_id', match: 'actorPrefixed' },
  ]);
  assert.equal(plan.steps[0].value, 'actor:carol@corp.in');
});

test('planErasure: subject is trimmed; blank subject yields no steps', () => {
  assert.equal(planErasure('  dave@corp.in  ').subject, 'dave@corp.in');
  const blank = planErasure('   ');
  assert.equal(blank.subject, '');
  assert.deepEqual(blank.steps, []);
  // deferred stores are always reported, even for a blank subject.
  assert.deepEqual(blank.deferred, [...DEFERRED_STORES]);
});

test('planErasure: never throws on nullish subject', () => {
  // @ts-expect-error deliberately passing a bad value
  assert.doesNotThrow(() => planErasure(null));
  // @ts-expect-error deliberately passing a bad value
  assert.deepEqual(planErasure(undefined).steps, []);
});

test('planErasure: always surfaces the deferred stores honestly', () => {
  const plan = planErasure('eve@corp.in');
  assert.deepEqual(plan.deferred, [...DEFERRED_STORES]);
  assert.ok(plan.deferred.some((d) => /vector index/i.test(d)));
});

test('summarizeErasure: all steps succeed → completed, rows summed', () => {
  const results: StepResult[] = [
    { store: 'a', table: 'a', deleted: 3, error: null },
    { store: 'b', table: 'b', deleted: 0, error: null },
    { store: 'c', table: 'c', deleted: 5, error: null },
  ];
  const report = summarizeErasure('x@corp.in', results, [...DEFERRED_STORES]);
  assert.equal(report.status, 'completed');
  assert.equal(report.erasedRows, 8);
  assert.equal(report.subject, 'x@corp.in');
  assert.equal(report.results.length, 3);
});

test('summarizeErasure: any step error → partial (honest, not silent)', () => {
  const results: StepResult[] = [
    { store: 'a', table: 'a', deleted: 2, error: null },
    { store: 'b', table: 'b', deleted: 0, error: 'relation does not exist' },
  ];
  const report = summarizeErasure('y@corp.in', results, []);
  assert.equal(report.status, 'partial');
  assert.equal(report.erasedRows, 2); // only successful deletes count
});
