import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomToken } from '../src/lib/rand.ts';

test('randomToken: default length is 4', () => {
  assert.equal(randomToken().length, 4);
});

test('randomToken: honours requested length', () => {
  for (const len of [1, 5, 6, 12, 64]) {
    assert.equal(randomToken(len).length, len);
  }
});

test('randomToken: len <= 0 yields empty string', () => {
  assert.equal(randomToken(0), '');
  assert.equal(randomToken(-3), '');
});

test('randomToken: only uses characters from the default alphabet', () => {
  const token = randomToken(200);
  assert.match(token, /^[0-9a-z]+$/);
});

test('randomToken: only uses characters from a custom alphabet', () => {
  const alphabet = 'ABCDEF';
  const token = randomToken(200, alphabet);
  for (const ch of token) assert.ok(alphabet.includes(ch), `unexpected char ${ch}`);
});

test('randomToken: handles a non-power-of-two alphabet length (no bias crash)', () => {
  // length 7 forces rejection sampling; just confirm it terminates with correct length + charset.
  const alphabet = 'abcdefg';
  const token = randomToken(50, alphabet);
  assert.equal(token.length, 50);
  for (const ch of token) assert.ok(alphabet.includes(ch));
});

test('randomToken: empty alphabet throws', () => {
  assert.throws(() => randomToken(4, ''), /alphabet must not be empty/);
});

test('randomToken: successive calls differ (collision-resistance)', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) seen.add(randomToken(8));
  // 8 chars over 36-symbol alphabet — 100 draws colliding would be astronomically unlikely.
  assert.equal(seen.size, 100);
});
