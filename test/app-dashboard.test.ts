import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAppDashboard, describeDurationMs, type DashboardRun } from '../src/lib/app-dashboard.ts';

// The dashboard is for the DEPARTMENT, not the platform team: how much got through, what is stuck, how
// long it takes, how often a person steps in. No tokens, latency percentiles or model names.

const NOW = Date.parse('2026-07-29T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const run = (over: Partial<DashboardRun> = {}): DashboardRun => ({
  status: 'done',
  startedAt: ago(1),
  finishedAt: new Date(Date.parse(ago(1)) + 120_000).toISOString(),
  ...over,
});

const dash = (runs: DashboardRun[], windowDays = 30) =>
  buildAppDashboard({ runs, nowMs: NOW, windowDays });

test('runs outside the window are excluded, and the window is NAMED in the headline', () => {
  // A bare count invites the reader to assume it is all-time.
  const d = dash([run({ startedAt: ago(3) }), run({ startedAt: ago(90) })]);
  assert.match(d.headline, /1 case in the last 30 days/);
  assert.equal(d.metrics.find((m) => m.label === 'Handled')?.value, '1');
});

test('waiting and failed counts are flagged for attention, and clean states are not', () => {
  const busy = dash([run({ status: 'awaiting_human' }), run({ status: 'error' })]);
  assert.equal(busy.metrics.find((m) => m.label === 'Waiting on a person')?.tone, 'attention');
  assert.equal(busy.metrics.find((m) => m.label === 'Could not finish')?.tone, 'attention');

  const clean = dash([run()]);
  assert.equal(clean.metrics.find((m) => m.label === 'Waiting on a person')?.tone, 'neutral');
  assert.equal(clean.metrics.find((m) => m.label === 'Could not finish')?.tone, 'neutral');
});

test('cancelled counts as could-not-finish, not as handled', () => {
  const d = dash([run({ status: 'cancelled' })]);
  assert.equal(d.metrics.find((m) => m.label === 'Could not finish')?.value, '1');
  assert.equal(d.metrics.find((m) => m.label === 'Handled')?.value, '0');
});

test('"usually takes" is the MEDIAN, so one pathological run cannot distort it', () => {
  const start = ago(2);
  const finish = (ms: number) => new Date(Date.parse(start) + ms).toISOString();
  const d = dash([
    run({ startedAt: start, finishedAt: finish(60_000) }),
    run({ startedAt: start, finishedAt: finish(120_000) }),
    run({ startedAt: start, finishedAt: finish(50 * 60_000) }),
  ]);
  // Mean would be ~17 minutes; median is 2.
  assert.equal(d.metrics.find((m) => m.label === 'Usually takes')?.value, '2 minutes');
});

test('a percentage is withheld rather than shown as 0% when there is nothing to divide by', () => {
  // "0% needed a person" reads as a finding; it is actually no data.
  const d = dash([]);
  assert.equal(d.metrics.find((m) => m.label === 'Needed a person')?.value, '—');
  assert.equal(d.isEmpty, true);
  assert.equal(d.headline, 'No cases in the last 30 days.');
});

test('needed-a-person is a share of all cases in the window', () => {
  const d = dash([run({ neededPerson: true }), run(), run(), run()]);
  assert.equal(d.metrics.find((m) => m.label === 'Needed a person')?.value, '25%');
});

test('durations read as plain english at every scale', () => {
  assert.equal(describeDurationMs(400), 'under a second');
  assert.equal(describeDurationMs(1000), '1 second');
  assert.equal(describeDurationMs(90_000), '2 minutes');
  assert.equal(describeDurationMs(3 * 3_600_000), '3 hours');
  assert.equal(describeDurationMs(5 * 86_400_000), '5 days');
  assert.equal(describeDurationMs(null), '—');
  assert.equal(describeDurationMs(-5), '—');
});

test('no metric leaks platform vocabulary to a department reader', () => {
  const d = dash([run({ neededPerson: true }), run({ status: 'awaiting_human' })]);
  const text = d.metrics.map((m) => `${m.label} ${m.detail}`).join(' ') + d.headline;
  assert.doesNotMatch(text, /token|latency|percentile|model|pipeline|guardrail|eval|provenance|p95/i);
  assert.doesNotMatch(text, /_/, 'no snake_case machine states');
});

test('unparseable timestamps are ignored rather than throwing', () => {
  const d = dash([run({ startedAt: 'not-a-date' }), run()]);
  assert.match(d.headline, /1 case/);
});

test('a finished run with no finish time does not corrupt the typical duration', () => {
  const d = dash([run({ finishedAt: null }), run()]);
  assert.equal(d.metrics.find((m) => m.label === 'Usually takes')?.value, '2 minutes');
});

test('waiting is NOT windowed — it must agree with the queue on the same screen', () => {
  // The bug this locks: the work screen said "2 cases are waiting" while the metric said 1, because one
  // had been pending longer than the 30-day window. A case pending a decision is pending regardless of
  // age, and an older one is MORE urgent.
  const d = dash([
    run({ status: 'awaiting_human', startedAt: ago(2) }),
    run({ status: 'awaiting_human', startedAt: ago(45) }),
  ]);
  assert.equal(d.metrics.find((m) => m.label === 'Waiting on a person')?.value, '2');
});

test('handled and could-not-finish REMAIN windowed — they describe a period', () => {
  const d = dash([run({ startedAt: ago(2) }), run({ startedAt: ago(45) })]);
  assert.equal(d.metrics.find((m) => m.label === 'Handled')?.value, '1');
});
