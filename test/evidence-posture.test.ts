import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allUnreadable, evidenceCards } from '../src/lib/evidence-posture.ts';

test('a real zero and an unreadable ledger are DIFFERENT', () => {
  const zero = evidenceCards({ audit: 0, refused: 0, signed: 0, exporters: 0 });
  assert.deepEqual(zero.map((c) => c.value), [0, 0, 0, 0]);
  // Missing counts must be null, never coerced to 0 — on a compliance page "0 blocked events" and
  // "we could not query the ledger" have opposite meanings.
  const failed = evidenceCards({});
  assert.deepEqual(failed.map((c) => c.value), [null, null, null, null]);
  assert.equal(allUnreadable(failed), true);
  assert.equal(allUnreadable(zero), false);
});

test('a null input yields four unreadable cards rather than throwing', () => {
  const cards = evidenceCards(null);
  assert.equal(cards.length, 4);
  assert.equal(allUnreadable(cards), true);
});

test('every card names what it counts and what zero means', () => {
  for (const c of evidenceCards({ audit: 5, refused: 0, signed: 2, exporters: 0 })) {
    assert.ok(c.unit.trim().length > 0, `${c.key} must say what it counts`);
    assert.ok(c.emptyNote.trim().length > 0, `${c.key} must explain a zero`);
  }
});

test('zero refusals is framed as a good posture, not a gap', () => {
  const security = evidenceCards({ refused: 0 }).find((c) => c.key === 'security');
  assert.match(security.emptyNote, /good posture/i);
});

test('NaN and non-finite counts are treated as unreadable', () => {
  const cards = evidenceCards({ audit: Number.NaN, refused: Infinity } as never);
  assert.equal(cards.find((c) => c.key === 'audit').value, null);
  assert.equal(cards.find((c) => c.key === 'security').value, null);
});
