import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isoObservedAtFromForm,
  parseActionOutcomeRequest,
} from '../src/lib/action-outcome-request.ts';

test('datetime form parsing returns an inline-safe error instead of throwing', () => {
  assert.deepEqual(isoObservedAtFromForm('not-a-date'), {
    ok: false,
    error: 'Enter a valid date and time.',
  });
  const valid = isoObservedAtFromForm('2026-07-22T10:30');
  assert.equal(valid.ok, true);
  if (valid.ok) assert.match(valid.value, /^2026-07-22T/);
});

test('request parser takes locators and kind from trusted route context and defaults evidence', () => {
  const result = parseActionOutcomeRequest(
    {
      outcomeCode: 'accepted',
      observedAt: '2026-07-22T10:00:00.000Z',
      eventId: 'mutation:accepted:1',
      note: 'Customer accepted during a recorded follow-up.',
      runId: 'forged',
      stepId: 'forged',
      kind: 'withdrawn',
      actionReceipt: { target: 'forged' },
    },
    { runId: 'run_1', stepId: 'act_1', kind: 'observed' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.runId, 'run_1');
  assert.equal(result.value.stepId, 'act_1');
  assert.equal(result.value.kind, 'observed');
  assert.deepEqual(result.value.evidenceLinks, ['/operations/runs/app%3Arun_1']);
  assert.deepEqual(result.value.source, { kind: 'human', eventId: 'mutation:accepted:1' });
  assert.equal('actionReceipt' in result.value, false);
});

test('request parser normalizes evidence and optional measured revenue', () => {
  const result = parseActionOutcomeRequest(
    {
      outcomeCode: 'converted',
      observedAt: '2026-07-22T10:00:00.000Z',
      eventId: 'mutation:converted:1',
      note: 'Customer completed the application.',
      evidenceLinks: [' /crm/opportunities/opp-1 ', '/crm/opportunities/opp-1'],
      measurement: {
        metricName: 'Incremental revenue',
        metricUnit: 'INR',
        resultValue: '25000',
        baselineValue: '',
      },
    },
    { runId: 'run_1', stepId: 'act_1', kind: 'observed' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.evidenceLinks, ['/crm/opportunities/opp-1']);
  assert.deepEqual(result.value.measurement, {
    metricName: 'Incremental revenue',
    metricUnit: 'INR',
    resultValue: 25000,
  });
});

test('request parser makes correction and withdrawal targets server-owned', () => {
  const corrected = parseActionOutcomeRequest(
    {
      outcomeCode: 'rejected',
      observedAt: '2026-07-22T10:00:00.000Z',
      eventId: 'mutation:correct:1',
      note: 'Corrected after checking the CRM note.',
      supersedesId: 'forged',
    },
    {
      runId: 'run_1',
      stepId: 'act_1',
      kind: 'corrected',
      supersedesId: 'out_1',
    },
  );
  assert.equal(corrected.ok, true);
  if (corrected.ok) assert.equal(corrected.value.supersedesId, 'out_1');

  const withdrawn = parseActionOutcomeRequest(
    {
      outcomeCode: 'converted',
      observedAt: '2026-07-22T10:00:00.000Z',
      eventId: 'mutation:withdraw:1',
      note: 'Withdrawn because the source record was reversed.',
    },
    {
      runId: 'run_1',
      stepId: 'act_1',
      kind: 'withdrawn',
      supersedesId: 'out_2',
    },
  );
  assert.equal(withdrawn.ok, true);
  if (withdrawn.ok) {
    assert.equal(withdrawn.value.outcomeCode, undefined);
    assert.equal(withdrawn.value.supersedesId, 'out_2');
  }
});

test('request parser returns contract errors for invalid browser input', () => {
  const result = parseActionOutcomeRequest(
    { outcomeCode: 'won', observedAt: 'later', eventId: '', note: '' },
    { runId: 'run_1', stepId: 'act_1', kind: 'observed' },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.errors, [
      'source event id is invalid',
      'observed time is invalid',
      'a plain-language note is required',
      'business outcome is invalid',
    ]);
  }
});
