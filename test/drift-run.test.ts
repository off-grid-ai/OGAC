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
  assert.equal(v!.engineLabel, 'Evidently');
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
