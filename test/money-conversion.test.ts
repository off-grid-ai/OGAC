// The gateway prices in USD; an org states value in its own currency. Those two met with no
// conversion — roi-reader.ts said the AI cost "passes straight through" — and the ROI page then
// rendered it with the rupee symbol and SUBTRACTED it from a rupee value to produce "net value".
//
// It stayed invisible because the demo's AI spend rounds to zero (~$0.05 → ₹0). At any real spend the
// net value is wrong by the whole FX rate, so these tests pin the conversion and, more importantly,
// its failure behaviour.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertUsd, DEFAULT_USD_RATES, formatMoney } from '@/lib/money';

test('a USD cost becomes a real rupee amount, not the same number relabelled', () => {
  const converted = convertUsd(10, 'INR');
  assert.equal(converted, 10 * DEFAULT_USD_RATES.INR);
  assert.notEqual(converted, 10, 'the bug was rendering 10 USD as ₹10');
});

test('USD to USD is identity', () => {
  assert.equal(convertUsd(42.5, 'USD'), 42.5);
});

test('an unknown currency leaves the amount visible rather than zeroing it', () => {
  // Deliberate: a cost that silently becomes 0 reads as "this was free", which is the dangerous
  // direction. Leaving it unconverted is wrong but visibly so.
  assert.equal(convertUsd(10, 'INR', {}), 10);
  assert.equal(convertUsd(10, 'INR', { INR: 0 }), 10, 'a zero rate must not erase the cost');
  assert.equal(convertUsd(10, 'INR', { INR: Number.NaN }), 10);
});

test('a non-finite input is zero, not NaN on the page', () => {
  assert.equal(convertUsd(Number.NaN), 0);
  assert.equal(convertUsd(Number.POSITIVE_INFINITY), 0);
});

test('the converted amount formats with the matching symbol', () => {
  // The point of the fix: the number and the symbol beside it are the same currency.
  const shown = formatMoney(convertUsd(1, 'INR'), 'INR');
  assert.match(shown, /₹/);
  assert.ok(!shown.includes('$'));
});

test('every supported currency has a usable rate', () => {
  for (const [code, rate] of Object.entries(DEFAULT_USD_RATES)) {
    assert.ok(Number.isFinite(rate) && rate > 0, `${code} needs a positive rate`);
  }
});
