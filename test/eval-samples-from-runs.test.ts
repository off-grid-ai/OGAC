import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type SampleRun,
  hasEvaluableRuns,
  sampleFromRun,
  samplesFromRuns,
} from '../src/lib/eval-samples-from-runs.ts';

// ── Faithfulness must be judged against the sources THE APP read ──────────────────────────────────────
//
// Four wrong diagnoses chasing one score of 0: wrong engine → missing ladder rung → missing contexts →
// contexts sourced from the wrong place. The last is the real one: samples came from the organizational
// brain, so when it returned nothing the sample had NO contexts and faithfulness became unmeasurable by
// every engine. And even working, judging an expense-claim app against a bank-policy corpus is the wrong
// question. These samples come from the app's own runs.

const run = (over: Partial<SampleRun> = {}): SampleRun => ({
  id: 'apprun_1',
  status: 'done',
  steps: [
    { kind: 'connector-query', status: 'done', outcome: 'expense claims: 1 row(s).\n[{"amount":"41346.44"}]' },
    { kind: 'connector-query', status: 'done', outcome: 'reimbursement quota: 6 row(s).\n[{"remaining":"137454.12"}]' },
    { kind: 'agent', status: 'done', label: 'Check Against Reimbursement Quota', outcome: 'Within quota.' },
  ],
  ...over,
});

describe('sampleFromRun', () => {
  test('sources contexts from the connector reads the app actually performed', () => {
    const s = sampleFromRun(run())!;
    assert.equal(s.contexts.length, 2);
    assert.match(s.contexts[0], /expense claims/);
    assert.match(s.contexts[1], /reimbursement quota/);
    assert.equal(s.answer, 'Within quota.');
    assert.equal(s.question, 'Check Against Reimbursement Quota');
  });

  test('returns null with NO contexts — the unmeasurable case must stay out of the corpus', () => {
    // This is the exact shape that produced four wrong diagnoses. Scoring it 0 calls the app unfaithful
    // when in truth nothing was measured.
    const bare = run({ steps: [{ kind: 'agent', status: 'done', outcome: 'Within quota.' }] });
    assert.equal(sampleFromRun(bare), null);
  });

  test('returns null with no answer', () => {
    const noAnswer = run({
      steps: [{ kind: 'connector-query', status: 'done', outcome: 'rows' }],
      outcome: '',
    });
    assert.equal(sampleFromRun(noAnswer), null);
  });

  test('ignores reads that did not complete — an unread source is not a source', () => {
    const partial = run({
      steps: [
        { kind: 'connector-query', status: 'error', outcome: 'Could not read quota — credential refused.' },
        { kind: 'connector-query', status: 'done', outcome: 'expense claims: 1 row(s).' },
        { kind: 'agent', status: 'done', outcome: 'Within quota.' },
      ],
    });
    const s = sampleFromRun(partial)!;
    assert.equal(s.contexts.length, 1);
    assert.ok(!s.contexts[0].includes('credential refused'));
  });

  test('falls back to the run outcome when no agent step carries one', () => {
    const s = sampleFromRun(
      run({
        steps: [{ kind: 'connector-query', status: 'done', outcome: 'rows' }],
        outcome: 'Approved.',
      }),
    )!;
    assert.equal(s.answer, 'Approved.');
  });

  test('groundTruth is empty, not invented — a production run has no expected answer', () => {
    assert.equal(sampleFromRun(run())!.groundTruth, '');
  });
});

describe('samplesFromRuns', () => {
  test('skips unmeasurable runs rather than padding the corpus', () => {
    const runs = [
      run({ id: '1' }),
      run({ id: '2', steps: [{ kind: 'agent', status: 'done', outcome: 'x' }] }), // no contexts
      run({ id: '3' }),
    ];
    assert.equal(samplesFromRuns(runs).length, 2);
  });

  test('caps the set', () => {
    assert.equal(samplesFromRuns(Array.from({ length: 20 }, () => run()), 5).length, 5);
  });

  test('no evaluable runs is reported, not scored as failure', () => {
    assert.equal(hasEvaluableRuns(samplesFromRuns([])), false);
    assert.equal(hasEvaluableRuns(samplesFromRuns([run()])), true);
  });
});
