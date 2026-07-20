import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QualityExecutionHistory } from '../src/components/evals/QualityExecutionHistory.tsx';
import type { EvalRunView } from '../src/lib/evals-view.ts';

const runs: EvalRunView[] = [
  {
    id: 'eval_b26bae5e3d2d',
    engine: 'golden',
    score: 83,
    total: 3,
    passed: 2,
    failed: 1,
    startedAt: '2026-07-09 18:14:09.519+00',
  },
  {
    id: 'eval_without_timestamp',
    engine: 'ragas',
    score: 91,
    total: 3,
    passed: 3,
    failed: 0,
    startedAt: null,
  },
];

test('Quality executions render complete narrow records and retain the wide table', () => {
  const html = renderToStaticMarkup(
    createElement(QualityExecutionHistory, {
      runs,
      actionsFor: (run: EvalRunView) =>
        createElement(
          'div',
          null,
          createElement('button', { type: 'button' }, 'Re-run'),
          createElement('a', { href: `/solutions/quality/runs/${run.id}` }, 'View run'),
        ),
    }),
  );

  const recordsStart = html.indexOf('data-quality-execution-records');
  const tableStart = html.indexOf('data-quality-execution-table');
  assert.ok(recordsStart >= 0, 'narrow execution records are rendered');
  assert.ok(tableStart > recordsStart, 'the wide execution table follows the narrow records');

  const records = html.slice(recordsStart, tableStart);
  assert.match(records, /role="list"/);
  assert.equal((records.match(/role="listitem"/g) ?? []).length, runs.length);
  assert.match(records, /class="grid gap-3 lg:hidden"/);
  assert.doesNotMatch(records, /overflow-x-auto/);

  for (const label of ['Run', 'Suite', 'Pass rate', 'Passed', 'Failed', 'Started', 'Actions']) {
    assert.match(
      records,
      new RegExp(`>${label}<`),
      `${label} remains visible in each narrow record`,
    );
  }
  for (const value of [
    'eval_b26bae5e3d2d',
    'Golden set',
    '83%',
    '2026-07-09 18:14:09.519+00',
    'eval_without_timestamp',
    'Retrieval quality',
    '91%',
    '—',
  ]) {
    assert.ok(records.includes(value), `${value} remains visible without table scrolling`);
  }
  assert.equal((records.match(/>Re-run</g) ?? []).length, runs.length);
  assert.equal((records.match(/>View run</g) ?? []).length, runs.length);

  const table = html.slice(tableStart);
  assert.match(table, /class="hidden lg:block"/);
  assert.match(table, /<table\b/);
  for (const heading of ['Run', 'Suite', 'Pass rate', 'Passed', 'Failed', 'Started', 'Actions']) {
    assert.match(table, new RegExp(`>${heading}<`), `${heading} remains in the wide table`);
  }
});
