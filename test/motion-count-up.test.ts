import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countUpStart,
  formatFrame,
  isAnimatableNumber,
  parseFormattedNumber,
} from '../src/lib/motion/count-up.ts';

// Pure logic behind the NumberTicker primitive. These prove the ticker settles on a value BYTE-FOR-
// BYTE identical to the static string it replaces, across every console stat shape (grouped, money,
// percent, decimals, negatives, non-numeric) — a ticker that lands on "1200" where the page said
// "1,200" would be a visible defect. Terminal artifact asserted: the rendered frame string.

test('parseFormattedNumber: plain integer', () => {
  const f = parseFormattedNumber('42');
  assert.deepEqual(f, { prefix: '', suffix: '', value: 42, decimals: 0, grouped: false });
});

test('parseFormattedNumber: grouped thousands preserves comma flag', () => {
  const f = parseFormattedNumber('1,200');
  assert.equal(f.value, 1200);
  assert.equal(f.grouped, true);
  assert.equal(f.decimals, 0);
});

test('parseFormattedNumber: currency prefix + magnitude suffix', () => {
  const f = parseFormattedNumber('$4.2M');
  assert.equal(f.prefix, '$');
  assert.equal(f.suffix, 'M');
  assert.equal(f.value, 4.2);
  assert.equal(f.decimals, 1);
});

test('parseFormattedNumber: percent suffix keeps decimals', () => {
  const f = parseFormattedNumber('98.60%');
  assert.equal(f.suffix, '%');
  assert.equal(f.value, 98.6);
  assert.equal(f.decimals, 2);
});

test('parseFormattedNumber: negative sign is part of the value, not the prefix', () => {
  const f = parseFormattedNumber('-3');
  assert.equal(f.value, -3);
  assert.equal(f.prefix, '');
});

test('parseFormattedNumber: unit suffix with space', () => {
  const f = parseFormattedNumber('15 req/s');
  assert.equal(f.value, 15);
  assert.equal(f.suffix, ' req/s');
});

test('parseFormattedNumber: non-numeric string is not animatable', () => {
  const f = parseFormattedNumber('n/a');
  assert.equal(Number.isNaN(f.value), true);
  assert.equal(isAnimatableNumber(f), false);
  assert.equal(f.prefix, 'n/a');
});

test('isAnimatableNumber: finite numbers animate, NaN does not', () => {
  assert.equal(isAnimatableNumber(parseFormattedNumber('0')), true);
  assert.equal(isAnimatableNumber(parseFormattedNumber('—')), false);
});

test('formatFrame: final frame reproduces the source string exactly (grouped)', () => {
  const f = parseFormattedNumber('1,200');
  assert.equal(formatFrame(1200, f), '1,200');
});

test('formatFrame: final frame reproduces currency + suffix + decimals', () => {
  const f = parseFormattedNumber('$4.2M');
  assert.equal(formatFrame(4.2, f), '$4.2M');
});

test('formatFrame: intermediate frame keeps decimals and grouping stable', () => {
  const f = parseFormattedNumber('98.60%');
  // A mid-animation value clamps to 2 decimals so digit width never jitters.
  assert.equal(formatFrame(50.5, f), '50.50%');
});

test('formatFrame: ungrouped source stays ungrouped mid-flight', () => {
  const f = parseFormattedNumber('1200');
  assert.equal(formatFrame(600, f), '600');
  assert.equal(formatFrame(1200, f), '1200');
});

test('formatFrame: non-finite frame renders just the affixes (no NaN on screen)', () => {
  const f = parseFormattedNumber('$5');
  assert.equal(formatFrame(Number.NaN, f), '$');
});

test('countUpStart: fraction 0 starts at zero, sign preserved for negatives', () => {
  assert.equal(countUpStart(1000, 0), 0);
  assert.equal(countUpStart(-40, 0.5), -20);
});

test('countUpStart: non-finite target yields 0 (never NaN into a spring)', () => {
  assert.equal(countUpStart(Number.NaN), 0);
});
