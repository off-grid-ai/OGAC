// "1 actions" and "1 triggers" appeared on most of the 193 cards in the action catalogue — small, and
// exactly what a buyer reads as carelessness on a page meant to look like a serious platform.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plural } from '@/lib/plural';

test('one is singular, everything else is not', () => {
  assert.equal(plural(1, 'action'), '1 action');
  assert.equal(plural(2, 'action'), '2 actions');
  assert.equal(plural(0, 'action'), '0 actions', 'zero takes the plural in English');
});

test('an irregular plural is passed, never guessed', () => {
  // English is not derivable from a rule; one that tries eventually produces "1 entrys".
  assert.equal(plural(1, 'entry', 'entries'), '1 entry');
  assert.equal(plural(4, 'entry', 'entries'), '4 entries');
});

test('large counts are grouped for an Indian reader', () => {
  assert.equal(plural(1235, 'action'), '1,235 actions');
  assert.equal(plural(1240000, 'action'), '12,40,000 actions');
});

test('a non-finite count reads as zero rather than NaN', () => {
  assert.equal(plural(Number.NaN, 'action'), '0 actions');
  assert.equal(plural(Number.POSITIVE_INFINITY, 'action'), '0 actions');
});
