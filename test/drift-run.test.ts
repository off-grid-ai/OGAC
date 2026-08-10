import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeDriftAttribution, summarizeDrift } from '../src/lib/drift-run.ts';

const base = {
  evidentlyVersion: '0.4.40',
  method: 'DataDriftPreset',
  driftShare: 0.5,
  status: 'warning' as const,
  baseline: 15,
  current: 15,
  note: 'ran',
};

test('summarizeDrift: real Evidently run → engineProven true, version retained', () => {
  const a = summarizeDrift({ ...base, engine: 'evidently', fallbackReason: null });
  assert.equal(a.engineProven, true);
  assert.equal(a.evidentlyVersion, '0.4.40');
  assert.equal(a.engine, 'evidently');
});

test('summarizeDrift: Evidently with a fallbackReason is NOT proven (cannot dress up a fallback)', () => {
  // engine claims evidently but a fallbackReason means it didn't really run → not proven.
  const a = summarizeDrift({ ...base, engine: 'evidently', fallbackReason: 'timeout' });
  assert.equal(a.engineProven, false);
  assert.equal(a.evidentlyVersion, null);
  assert.equal(a.fallbackReason, 'timeout');
});

test('summarizeDrift: native PSI is never engineProven and carries no evidently version', () => {
  const a = summarizeDrift({ ...base, engine: 'native', evidentlyVersion: null, fallbackReason: 'ECONNREFUSED' });
  assert.equal(a.engineProven, false);
  assert.equal(a.evidentlyVersion, null);
  assert.equal(a.engine, 'native');
});

test('describeDriftAttribution: normalizes engine label + drift pct', () => {
  const v = describeDriftAttribution(
    summarizeDrift({ ...base, engine: 'evidently', fallbackReason: null }) as unknown as Record<string, unknown>,
  );
  assert.ok(v);
  assert.equal(v!.engineLabel, 'Verified drift engine');
  assert.equal(v!.engineProven, true);
  assert.equal(v!.driftPct, 50);
  assert.equal(v!.status, 'warning');
});

test('describeDriftAttribution: null/garbage → null (legacy rows never throw)', () => {
  assert.equal(describeDriftAttribution(null), null);
  assert.equal(describeDriftAttribution(undefined), null);
  const v = describeDriftAttribution({ engine: 'native' });
  assert.equal(v?.engineLabel, 'Off Grid PSI');
  assert.equal(v?.driftPct, null);
});

test('A SIDECAR THAT FELL BACK IS NOT A PROVEN EVIDENTLY RUN', () => {
  // The sidecar returns the same response shape whether Evidently ran or whether it fell back to a
  // first-party PSI approximation. Before it reported which, a rough approximation was indistinguishable
  // from a real Evidently verdict — and the console printed `Evidently ran "<selection>"` regardless,
  // a claim about work that may never have happened.
  const fellBack = summarizeDrift({
    ...base,
    engine: 'native',
    fallbackReason: 'Evidently did not run (each window needs at least 2 points)',
  });
  assert.equal(fellBack.engineProven, false);
  // And the version must NOT survive onto a run the engine did not produce.
  assert.equal(fellBack.evidentlyVersion, null);
  // The reason has to survive onto the view a person reads, or the run just looks native for no
  // stated cause.
  assert.match(describeDriftAttribution(fellBack)?.fallbackReason ?? '', /2 points/);
});

test('the method recorded is the one APPLIED, not the one requested', () => {
  // The two differ when the installed build has no such preset — data_summary does not exist in 0.4.40
  // and runs as data_quality. Recording the request would make the attribution agree with what we hoped
  // for rather than what happened.
  const a = summarizeDrift({ ...base, engine: 'evidently', method: 'data_quality', fallbackReason: null });
  assert.equal(a.method, 'data_quality');
  assert.equal(a.engineProven, true);
});
