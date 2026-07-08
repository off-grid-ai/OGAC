import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heuristicGrounding } from '@/lib/adapters/grounding';
import type { GroundingSource } from '@/lib/adapters/types';

// The lexical (first-party, offline) grounding adapter. Fully deterministic — token-overlap between
// each answer claim and the best-matching cited source, no model/gateway. Exercising verify() drives
// the whole pure pipeline (splitClaims → lexicalVerdict → aggregate). Real functions, no mocks.

test('heuristicGrounding.health: the offline baseline is always available', async () => {
  assert.equal(await heuristicGrounding.health(), true);
});

test('verify: a claim fully covered by a source is supported; the score aggregates per-claim verdicts', async () => {
  const sources: GroundingSource[] = [
    { id: 'S1', text: 'The Reserve Bank of India sets the repo rate for the banking system.' },
  ];
  const res = await heuristicGrounding.verify(
    'The Reserve Bank of India sets the repo rate.',
    sources,
  );
  assert.equal(res.verdicts.length, 1);
  const v = res.verdicts[0];
  assert.equal(v.supported, true, `expected supported, got score ${v.score}`);
  assert.ok(v.score >= 0.6);
  assert.equal(v.source, 'S1');
  assert.equal(res.score, 100); // 1/1 supported → 100%
});

test('verify: an unsupported claim scores low and drags the aggregate down', async () => {
  const sources: GroundingSource[] = [{ text: 'Photosynthesis converts light into chemical energy.' }];
  const res = await heuristicGrounding.verify(
    'Interest rates rose sharply across every emerging market last quarter.',
    sources,
  );
  assert.equal(res.verdicts.length, 1);
  assert.equal(res.verdicts[0].supported, false);
  assert.equal(res.score, 0);
  // No id supplied → the source label falls back to a slice of the text.
  assert.equal(res.verdicts[0].source, undefined); // zero overlap → best.source never set
});

test('verify: splits multiple sentences into separate claims and mixes verdicts', async () => {
  const sources: GroundingSource[] = [
    { id: 'doc', text: 'Mumbai is the financial capital of India. HDFC Bank is headquartered there.' },
  ];
  const res = await heuristicGrounding.verify(
    'Mumbai is the financial capital of India. The Eiffel Tower is in Paris.',
    sources,
  );
  assert.equal(res.verdicts.length, 2); // two sentences → two claims
  assert.equal(res.verdicts[0].supported, true);
  assert.equal(res.verdicts[1].supported, false);
  assert.equal(res.score, 50); // 1 of 2 supported
});

test('verify: empty answer → no claims, zero score, no truncation', async () => {
  const res = await heuristicGrounding.verify('', [{ text: 'anything' }]);
  assert.deepEqual(res.verdicts, []);
  assert.equal(res.score, 0);
  assert.equal(res.truncated, undefined);
});

test('verify: more than MAX_CLAIMS (12) sentences reports the truncated overflow count', async () => {
  const answer = Array.from({ length: 15 }, (_, i) => `Sentence number ${i}.`).join(' ');
  const res = await heuristicGrounding.verify(answer, [{ text: 'number sentence' }]);
  assert.equal(res.verdicts.length, 12); // capped
  assert.equal(res.truncated, 3); // 15 - 12
});
