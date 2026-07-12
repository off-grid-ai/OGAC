import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRunQuery } from '../src/lib/run-query-view.ts';

// Pure inverse of buildAgentQuery (app-run.ts). A composed query splits into prior-context blocks +
// the actual task; a plain query passes through as just its task. No I/O, no mocks.

// The exact shape buildAgentQuery emits (a connector-query output that itself carries JSON — the
// item-3 case: "CONTEXT FROM PRIOR STEPS: N row(s). [{...}]").
const COMPOSED = `CONTEXT FROM PRIOR STEPS:
- [connector-query] Read 2 row(s). [{"pan":"ABCDE1234F"},{"pan":"ZZZZZ9999Z"}]
- [agent] The customer is a medium-risk profile due for Re-KYC.

TASK: Draft the Re-KYC notice for the claims officer.`;

test('parseRunQuery: composed query → task + context blocks (no raw JSON wall as the title)', () => {
  const v = parseRunQuery(COMPOSED);
  assert.equal(v.task, 'Draft the Re-KYC notice for the claims officer.');
  assert.equal(v.context.length, 2);
  assert.equal(v.context[0].kind, 'connector-query');
  assert.ok(v.context[0].text.includes('Read 2 row(s).'));
  assert.ok(v.context[0].text.includes('ABCDE1234F')); // JSON preserved, but inside a block
  assert.equal(v.context[1].kind, 'agent');
  assert.equal(v.context[1].text, 'The customer is a medium-risk profile due for Re-KYC.');
  // the header itself is never part of the rendered task
  assert.ok(!v.task.includes('CONTEXT FROM PRIOR STEPS'));
});

test('parseRunQuery: multi-line JSON block attaches to its header, not a new block', () => {
  const q = `CONTEXT FROM PRIOR STEPS:
- [connector-query] Read 1 row(s).
  [{"a":1,
    "b":2}]

TASK: Summarise.`;
  const v = parseRunQuery(q);
  assert.equal(v.context.length, 1);
  assert.ok(v.context[0].text.includes('"a":1'));
  assert.ok(v.context[0].text.includes('"b":2'));
  assert.equal(v.task, 'Summarise.');
});

test('parseRunQuery: plain (uncomposed) query → task only, no context', () => {
  const v = parseRunQuery('What is the Re-KYC window for medium-risk customers?');
  assert.equal(v.task, 'What is the Re-KYC window for medium-risk customers?');
  assert.deepEqual(v.context, []);
});

test('parseRunQuery: header with no TASK marker → all context, empty task', () => {
  const v = parseRunQuery('CONTEXT FROM PRIOR STEPS:\n- [agent] partial output only');
  assert.equal(v.task, '');
  assert.equal(v.context.length, 1);
  assert.equal(v.context[0].kind, 'agent');
  assert.equal(v.context[0].text, 'partial output only');
});

test('parseRunQuery: a context line with an empty kind tag falls back to "step"', () => {
  const v = parseRunQuery('CONTEXT FROM PRIOR STEPS:\n- [] something\n\nTASK: go');
  assert.equal(v.context[0].kind, 'step');
  assert.equal(v.context[0].text, 'something');
  assert.equal(v.task, 'go');
});

test('parseRunQuery: empty / null / undefined → empty task, no context', () => {
  assert.deepEqual(parseRunQuery(''), { task: '', context: [] });
  assert.deepEqual(parseRunQuery('   '), { task: '', context: [] });
  assert.deepEqual(parseRunQuery(null), { task: '', context: [] });
  assert.deepEqual(parseRunQuery(undefined), { task: '', context: [] });
});
