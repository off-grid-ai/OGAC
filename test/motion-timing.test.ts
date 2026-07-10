import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DURATION,
  EASE,
  effectiveDuration,
  shouldAnimateLoop,
  staggerDelay,
} from '../src/lib/motion/timing.ts';

// The motion timing contract. These lock the restraint budget (durations stay inside the
// philosophy's micro/hover/reveal bands) and — the load-bearing rule — prove reduced-motion ALWAYS
// collapses animation to an instant snap and disables loops. A regression here would let motion run
// against a user's OS preference, which is an accessibility defect.

test('durations sit inside the philosophy bands (micro < hover < reveal < data)', () => {
  assert.ok(DURATION.micro < DURATION.hover);
  assert.ok(DURATION.hover < DURATION.reveal);
  assert.ok(DURATION.reveal < DURATION.data);
  // micro is genuinely micro (<= 150ms), hover perceptible (<= 300ms), per §7.
  assert.ok(DURATION.micro <= 0.15);
  assert.ok(DURATION.hover <= 0.3);
});

test('every easing curve is a 4-tuple cubic-bezier with no bounce (end anchored at 1)', () => {
  for (const key of Object.keys(EASE) as (keyof typeof EASE)[]) {
    const curve = EASE[key];
    assert.equal(curve.length, 4);
    // y2 = 1 means it settles at the target without overshoot.
    assert.equal(curve[3], 1);
  }
});

test('effectiveDuration: reduced motion snaps to 0 for every token', () => {
  for (const token of Object.keys(DURATION) as (keyof typeof DURATION)[]) {
    assert.equal(effectiveDuration(token, true), 0);
    assert.equal(effectiveDuration(token, false), DURATION[token]);
  }
});

test('shouldAnimateLoop: loops run only when motion is not reduced', () => {
  assert.equal(shouldAnimateLoop(false), true);
  assert.equal(shouldAnimateLoop(true), false);
});

test('staggerDelay: linear step up to the cap, then plateaus', () => {
  assert.equal(staggerDelay(0), 0);
  assert.equal(staggerDelay(3, 0.06), 0.18);
  // Beyond maxVisible the delay stops growing so a long list has a bounded tail.
  assert.equal(staggerDelay(50, 0.06, 12), staggerDelay(12, 0.06, 12));
});

test('staggerDelay: negative index is clamped to 0', () => {
  assert.equal(staggerDelay(-5), 0);
});
