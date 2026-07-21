import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deepStripNul, stripNul } from '../src/lib/jsonb-safe.ts';

const NUL = '\u0000';

test('stripNul removes NUL, leaves other text intact', () => {
  assert.equal(stripNul(`${NUL}masked:PAN`), 'masked:PAN');
  assert.equal(stripNul(`a${NUL}b${NUL}c`), 'abc');
  assert.equal(stripNul('no nul here'), 'no nul here');
});

test('stripNul keeps the U+001F sentinel (only NUL is unstorable)', () => {
  const unitSep = '\u001f';
  assert.equal(stripNul(`${unitSep}masked:x`), `${unitSep}masked:x`);
});

test('deepStripNul sanitizes nested check objects/arrays', () => {
  const checks = [
    { name: 'pii', verdict: 'redacted', detail: `${NUL}masked:PAN${NUL}PII redacted` },
    { name: 'grounding', verdict: 'warn', score: 0.4 },
  ];
  const out = deepStripNul(checks);
  assert.equal(out[0].detail, 'masked:PANPII redacted');
  assert.equal(out[1].score, 0.4); // numbers pass through
  assert.equal(JSON.stringify(out).includes(NUL), false);
});

test('deepStripNul passes non-string leaves through unchanged', () => {
  assert.equal(deepStripNul(42), 42);
  assert.equal(deepStripNul(true), true);
  assert.equal(deepStripNul(null), null);
  assert.deepEqual(deepStripNul({ a: 1, b: [2, `x${NUL}y`] }), { a: 1, b: [2, 'xy'] });
});
