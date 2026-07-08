import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateReleaseGate,
  thresholdToPct,
  type GateEvalDef,
  type GateEvalResult,
} from '../src/lib/release-gate.ts';

// Unit tests for the PURE release-gate decision. No I/O.

const def = (id: string, threshold: number): GateEvalDef => ({ id, name: id, threshold });
const res = (
  id: string,
  score: number,
  thresholdPct: number,
  scored = true,
): GateEvalResult => ({ evalId: id, name: id, score, thresholdPct, scored });

test('no attached evals ⇒ pass, ungated (publish not blocked — additive/safe)', () => {
  const d = evaluateReleaseGate([], []);
  assert.equal(d.pass, true);
  assert.equal(d.gated, false);
  assert.equal(d.failing.length, 0);
});

test('all evals at/above threshold ⇒ pass, gated', () => {
  const defs = [def('a', 0.8), def('b', 0.7)];
  const results = [res('a', 90, 80), res('b', 70, 70)]; // b exactly at threshold passes (≥)
  const d = evaluateReleaseGate(defs, results);
  assert.equal(d.pass, true);
  assert.equal(d.gated, true);
  assert.equal(d.passed, 2);
  assert.equal(d.failing.length, 0);
});

test('one eval below threshold ⇒ fail, names the failing eval', () => {
  const defs = [def('a', 0.8), def('b', 0.9)];
  const results = [res('a', 90, 80), res('b', 60, 90)];
  const d = evaluateReleaseGate(defs, results);
  assert.equal(d.pass, false);
  assert.equal(d.gated, true);
  assert.equal(d.passed, 1);
  assert.equal(d.failing.length, 1);
  assert.equal(d.failing[0].evalId, 'b');
  assert.equal(d.failing[0].score, 60);
  assert.equal(d.failing[0].thresholdPct, 90);
});

test('unscored eval is carried honestly — does not pass, does not fail the gate', () => {
  const defs = [def('a', 0.8)];
  const results = [res('a', 0, 80, false)]; // could not score
  const d = evaluateReleaseGate(defs, results);
  assert.equal(d.pass, true); // not blocked on a verdict we could not compute
  assert.equal(d.gated, false); // no real verdict contributed
  assert.equal(d.unscored.length, 1);
  assert.equal(d.passed, 0);
});

test('missing result for an attached eval is treated as unscored (never a fake pass)', () => {
  const defs = [def('a', 0.8), def('b', 0.7)];
  const results = [res('a', 90, 80)]; // b never ran
  const d = evaluateReleaseGate(defs, results);
  assert.equal(d.pass, true); // a passed, b unscored → no failure
  assert.equal(d.gated, true);
  assert.equal(d.unscored.length, 1);
  assert.equal(d.unscored[0].evalId, 'b');
});

test('a scored fail + an unscored eval still FAILS the gate on the real verdict', () => {
  const defs = [def('a', 0.8), def('b', 0.7)];
  const results = [res('a', 50, 80), res('b', 0, 70, false)];
  const d = evaluateReleaseGate(defs, results);
  assert.equal(d.pass, false);
  assert.equal(d.failing.length, 1);
  assert.equal(d.unscored.length, 1);
});

test('thresholdToPct clamps + rounds to 0..100', () => {
  assert.equal(thresholdToPct(0.8), 80);
  assert.equal(thresholdToPct(0), 0);
  assert.equal(thresholdToPct(1), 100);
  assert.equal(thresholdToPct(1.5), 100);
  assert.equal(thresholdToPct(-1), 0);
  assert.equal(thresholdToPct(Number.NaN), 0);
});
