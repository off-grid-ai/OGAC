import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppRunState, StepState } from '../src/lib/app-run-plan.ts';
import {
  appRunInputText,
  appRunOutputText,
  shouldScoreAppRun,
} from '../src/lib/qa/app-run-score.ts';
import { scorable, shouldSampleForScoring } from '../src/lib/qa/score-and-retain.ts';

const step = (id: string, output?: string, over: Partial<StepState> = {}): StepState =>
  ({ id, kind: 'agent', status: output === undefined ? 'queued' : 'done', output, ...over }) as StepState;

const state = (over: Partial<AppRunState> = {}): AppRunState =>
  ({ runId: 'apprun_1', appId: 'app_kyc', status: 'done', steps: [], ...over }) as AppRunState;

// ─── which input text the judge sees ──────────────────────────────────────────────────────────────

test('a person\'s own words are preferred over the rest of the form', () => {
  assert.equal(
    appRunInputText({ tenantId: 'org_bharat', question: 'Is this PAN valid?', retries: 2 }),
    'Is this PAN valid?',
  );
  assert.equal(appRunInputText({ input: '  padded  ' }), 'padded');
});

test('a form with no obvious question still gives the judge something real', () => {
  const text = appRunInputText({ panNumber: 'ABCDE1234F', branch: 'Andheri East', amount: 250000 });
  assert.match(text, /panNumber: ABCDE1234F/);
  assert.match(text, /branch: Andheri East/);
  assert.match(text, /amount: 250000/);
});

test('nested objects are skipped rather than dumped as [object Object]', () => {
  const text = appRunInputText({ applicant: { name: 'Rohan' }, ifsc: 'HDFC0001234' });
  assert.equal(text, 'ifsc: HDFC0001234');
  assert.doesNotMatch(text, /object Object/);
});

test('an empty input yields empty text, which is not scorable', () => {
  assert.equal(appRunInputText({}), '');
  assert.equal(scorable({ input: '', output: 'an answer' }), false);
  assert.equal(scorable({ input: 'a question', output: '   ' }), false);
  assert.equal(scorable({ input: 'a question', output: 'an answer' }), true);
});

// ─── which output the judge sees ──────────────────────────────────────────────────────────────────

test('the app answer is the last non-empty step output, not the first', () => {
  const s = state({
    steps: [step('a', 'fetched 20 rows'), step('b', 'The PAN is valid and matches the KYC record.')],
  });
  assert.equal(appRunOutputText(s), 'The PAN is valid and matches the KYC record.');
});

test('trailing steps that produced nothing are skipped', () => {
  const s = state({ steps: [step('a', 'the real answer'), step('b'), step('c', '   ')] });
  assert.equal(appRunOutputText(s), 'the real answer');
});

// ─── when scoring fires ───────────────────────────────────────────────────────────────────────────

test('only a succeeded run with an actual answer is scored', () => {
  const answered = [step('a', 'an answer')];
  assert.equal(shouldScoreAppRun(state({ status: 'done', steps: answered })), true);

  // upsertAppRunState is called after EVERY step transition; mid-run states must not fire the judge.
  assert.equal(shouldScoreAppRun(state({ status: 'running', steps: answered })), false);
  assert.equal(shouldScoreAppRun(state({ status: 'queued', steps: answered })), false);
  assert.equal(shouldScoreAppRun(state({ status: 'awaiting-human', steps: answered })), false);
});

test('a failed or cancelled run is never scored — a run with no answer has no answer quality', () => {
  // Scoring an empty failure as 0 would corrupt the quality trend with reliability problems.
  assert.equal(shouldScoreAppRun(state({ status: 'error', steps: [step('a', 'partial')] })), false);
  assert.equal(shouldScoreAppRun(state({ status: 'cancelled', steps: [step('a', 'partial')] })), false);
  assert.equal(shouldScoreAppRun(state({ status: 'done', steps: [] })), false);
  assert.equal(shouldScoreAppRun(state({ status: 'done', steps: [step('a', '  ')] })), false);
});

// ─── the sampling policy shared by agent and app scoring ──────────────────────────────────────────

test('an unset or unparseable sample rate measures everything', () => {
  assert.equal(shouldSampleForScoring(undefined, 0.99), true);
  assert.equal(shouldSampleForScoring('not-a-number', 0.99), true);
});

test('a sample rate keeps the draws below it and drops the rest', () => {
  assert.equal(shouldSampleForScoring('0.5', 0.4), true);
  assert.equal(shouldSampleForScoring('0.5', 0.5), true); // boundary counts as sampled
  assert.equal(shouldSampleForScoring('0.5', 0.6), false);
  assert.equal(shouldSampleForScoring('0', 0.0001), false); // fully disabled
  assert.equal(shouldSampleForScoring('1', 1), true); // fully enabled
});

// The guard inside scoreAndRetain is reachable with zero I/O: a blank side means there is nothing to
// judge, so it must decline BEFORE touching the flag port or the gateway. (The judged path itself
// needs a live gateway and is covered by the live outcome verification, not by a mock.)
test('scoring declines an unjudgeable interaction without calling anything', async () => {
  const { scoreAndRetain } = await import('../src/lib/qa/score-and-retain.ts');
  const base = { runId: 'apprun_blank', orgId: 'default', subjectId: 'app:app_kyc' };

  assert.equal(await scoreAndRetain({ ...base, input: '', output: 'an answer' }), false);
  assert.equal(await scoreAndRetain({ ...base, input: 'a question', output: '' }), false);
  assert.equal(await scoreAndRetain({ ...base, input: '  ', output: '  ' }), false);
});

test('an app run with nothing to judge is skipped rather than scored as zero', async () => {
  const { scoreAppRun } = await import('../src/lib/qa/app-run-score.ts');
  // Succeeded, but the only step produced no text — there is no answer to have quality about.
  assert.equal(await scoreAppRun(state({ status: 'done', steps: [step('a', '  ')] }), {}, 'default'), false);
  // Succeeded with an answer but an empty trigger record: still not a judgeable pair.
  assert.equal(
    await scoreAppRun(state({ status: 'done', steps: [step('a', 'an answer')] }), {}, 'default'),
    false,
  );
});
