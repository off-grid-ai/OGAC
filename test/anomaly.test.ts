import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectAnomalies, latestIsAnomalous, type SeriesPoint } from '../src/lib/anomaly.ts';

// PURE unit tests for the rolling anomaly detector (M5). Synthetic series: a stable baseline with an
// injected spike / dip, and a clean series that must stay silent. No I/O.

function series(values: number[]): SeriesPoint[] {
  return values.map((v, i) => ({ label: `d${i}`, value: v }));
}

test('flags a clear spike above the series own baseline (MAD)', () => {
  // 10 days ~100, then a 500 spike.
  const s = series([100, 102, 98, 101, 99, 100, 103, 97, 100, 500]);
  const scan = detectAnomalies(s, { window: 7 });
  assert.equal(scan.method, 'mad');
  assert.ok(scan.anomalies.length >= 1, 'should flag the spike');
  const spike = scan.anomalies.find((a) => a.value === 500);
  assert.ok(spike, 'the 500 point is flagged');
  assert.equal(spike!.direction, 'spike');
});

test('flags a clear dip below baseline', () => {
  const s = series([200, 205, 198, 202, 199, 201, 203, 200, 197, 5]);
  const scan = detectAnomalies(s, { window: 7 });
  const dip = scan.anomalies.find((a) => a.value === 5);
  assert.ok(dip, 'the dip is flagged');
  assert.equal(dip!.direction, 'dip');
});

test('a smooth, stationary series produces NO anomalies', () => {
  const s = series([50, 51, 49, 50, 52, 48, 50, 51, 49, 50, 51, 50]);
  const scan = detectAnomalies(s, { window: 7, threshold: 3 });
  assert.equal(scan.anomalies.length, 0, `expected none, got ${JSON.stringify(scan.anomalies)}`);
});

test('never flags points inside the seed window (too little history)', () => {
  const s = series([1000, 1, 1, 1, 1, 1, 1, 1]);
  const scan = detectAnomalies(s, { window: 7 });
  // The 1000 is at index 0 (inside the window) — cannot be flagged.
  assert.ok(!scan.anomalies.some((a) => a.index === 0));
});

test('only:spike suppresses dips', () => {
  const s = series([100, 100, 100, 100, 100, 100, 100, 5]);
  const both = detectAnomalies(s, { window: 7 });
  const spikeOnly = detectAnomalies(s, { window: 7, only: 'spike' });
  assert.ok(both.anomalies.length >= 1);
  assert.equal(spikeOnly.anomalies.length, 0, 'a dip must be suppressed under only:spike');
});

test('a jump off a perfectly flat baseline is caught and reported as a large finite deviation', () => {
  const s = series([10, 10, 10, 10, 10, 10, 10, 42]);
  const scan = detectAnomalies(s, { window: 7 });
  const jump = scan.anomalies.find((a) => a.value === 42);
  assert.ok(jump, 'flat-baseline jump is flagged');
  assert.ok(Number.isFinite(jump!.deviation), 'deviation is finite for JSON');
  assert.ok(Math.abs(jump!.deviation) >= 100, 'reported as a large deviation');
});

test('severity escalates to critical past the critical threshold', () => {
  const s = series([100, 100, 100, 100, 100, 100, 100, 100, 100, 100000]);
  const scan = detectAnomalies(s, { window: 7, criticalThreshold: 5 });
  const spike = scan.anomalies.find((a) => a.value === 100000);
  assert.equal(spike!.severity, 'critical');
});

test('zscore method also detects a spike', () => {
  const s = series([10, 12, 11, 9, 10, 11, 10, 60]);
  const scan = detectAnomalies(s, { window: 7, method: 'zscore' });
  assert.equal(scan.method, 'zscore');
  assert.ok(scan.anomalies.some((a) => a.value === 60));
});

test('latestIsAnomalous returns the last-point anomaly or null', () => {
  const spikeLast = series([100, 100, 100, 100, 100, 100, 100, 900]);
  const scan = detectAnomalies(spikeLast, { window: 7 });
  const latest = latestIsAnomalous(scan);
  assert.ok(latest, 'the last point is anomalous');
  assert.equal(latest!.value, 900);

  // A varying-but-stationary series: last point sits inside normal spread → not anomalous.
  const calm = series([98, 102, 99, 101, 100, 103, 97, 100]);
  assert.equal(latestIsAnomalous(detectAnomalies(calm, { window: 7 })), null);
});

test('non-finite values are skipped, not treated as anomalies', () => {
  const s: SeriesPoint[] = [
    { label: 'a', value: 10 },
    { label: 'b', value: 10 },
    { label: 'c', value: 10 },
    { label: 'd', value: 10 },
    { label: 'e', value: NaN },
  ];
  const scan = detectAnomalies(s, { window: 3 });
  assert.ok(!scan.anomalies.some((a) => Number.isNaN(a.value)));
});
