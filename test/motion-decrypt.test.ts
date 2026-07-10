import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptFrame, isDecrypted } from '@/lib/motion/decrypt';

test('decryptFrame: progress 1 renders the exact final text', () => {
  assert.equal(decryptFrame('Put AI to work', 1), 'Put AI to work');
});

test('decryptFrame: progress 0 scrambles every non-space character', () => {
  const out = decryptFrame('AB', 0);
  assert.equal(out.length, 2);
  assert.notEqual(out, 'AB');
});

test('decryptFrame: whitespace is preserved (word shape holds)', () => {
  const out = decryptFrame('a b', 0);
  assert.equal(out[1], ' ', 'the space is never scrambled');
});

test('decryptFrame: resolves left-to-right as progress grows', () => {
  const text = 'ABCDEFGH';
  const half = decryptFrame(text, 0.5);
  assert.equal(half.slice(0, 4), 'ABCD', 'first half is resolved');
});

test('decryptFrame: deterministic for a given seed (stable/testable)', () => {
  assert.equal(decryptFrame('ABCD', 0, 7), decryptFrame('ABCD', 0, 7));
});

test('decryptFrame: clamps out-of-range and NaN progress', () => {
  assert.equal(decryptFrame('AB', 5), 'AB', 'over 1 clamps to fully resolved');
  assert.equal(decryptFrame('AB', 0), decryptFrame('AB', -3), 'under 0 clamps to 0');
  assert.equal(decryptFrame('AB', 0), decryptFrame('AB', Number.NaN), 'NaN treated as 0');
});

test('isDecrypted: true only once every character has resolved', () => {
  assert.equal(isDecrypted('ABC', 1), true);
  assert.equal(isDecrypted('ABC', 0.99), false);
  assert.equal(isDecrypted('ABC', 0), false);
});
