import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeModelGrounding } from '@/lib/adapters/grounding';
import {
  buildEntailmentPrompt,
  extractCompletionText,
  parseModelVerdicts,
  scoreVerdicts,
  splitClaims,
  verifyWithModel,
} from '@/lib/adapters/grounding-model';
import type { EntailmentModel } from '@/lib/adapters/grounding-model';
import type { GroundingSource } from '@/lib/adapters/types';

// The model-NLI (entailment-grade) grounding adapter. Everything here exercises REAL pure logic;
// the ONLY thing stubbed is the injected model fn — the network seam — so a test can decide what
// the model "said" and assert how it's parsed and scored. This is exactly the paraphrase case that
// the lexical floor cannot handle (G-F3): an entailed paraphrase shares few tokens with the source,
// so the lexical adapter scores it 0, but when the model judges it entailed it scores supported.

// ─── splitClaims ────────────────────────────────────────────────────────────────
test('splitClaims: one claim per sentence, trims + drops empties', () => {
  assert.deepEqual(splitClaims('A is true. B is false! Is C?  '), [
    'A is true.',
    'B is false!',
    'Is C?',
  ]);
  assert.deepEqual(splitClaims(''), []);
  assert.deepEqual(splitClaims('   '), []);
});

// ─── buildEntailmentPrompt ────────────────────────────────────────────────────────
test('buildEntailmentPrompt: numbers sources + claims and demands paraphrase-aware JSON', () => {
  const p = buildEntailmentPrompt(['The RBI sets rates.'], [{ id: 'doc1', text: 'RBI sets the repo rate.' }]);
  assert.match(p, /\[S1 doc1\] RBI sets the repo rate\./);
  assert.match(p, /0\. The RBI sets rates\./);
  assert.match(p, /PARAPHRASES/i); // instructs the model to judge meaning, not overlap
  assert.match(p, /"verdicts"/);
});

test('buildEntailmentPrompt: tolerates zero sources without crashing', () => {
  const p = buildEntailmentPrompt(['A claim.'], []);
  assert.match(p, /\(no sources provided\)/);
});

// ─── extractCompletionText ─────────────────────────────────────────────────────────
test('extractCompletionText: pulls choices[0].message.content; safe on junk', () => {
  assert.equal(
    extractCompletionText({ choices: [{ message: { content: '{"verdicts":[]}' } }] }),
    '{"verdicts":[]}',
  );
  assert.equal(extractCompletionText({}), '');
  assert.equal(extractCompletionText(null), '');
  assert.equal(extractCompletionText({ choices: [] }), '');
});

// ─── parseModelVerdicts ─────────────────────────────────────────────────────────────
test('parseModelVerdicts: {verdicts:[...]} wrapper', () => {
  const out = parseModelVerdicts('{"verdicts":[{"index":0,"supported":true,"score":0.9,"source":"S1"}]}');
  assert.equal(out.length, 1);
  assert.equal(out[0].index, 0);
});

test('parseModelVerdicts: bare array', () => {
  const out = parseModelVerdicts('[{"index":0,"supported":false,"score":0.1}]');
  assert.equal(out.length, 1);
  assert.equal(out[0].supported, false);
});

test('parseModelVerdicts: strips ```json fences and surrounding prose', () => {
  const raw = 'Here is my answer:\n```json\n{"verdicts":[{"index":0,"supported":true,"score":0.8}]}\n```\nDone.';
  const out = parseModelVerdicts(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 0.8);
});

test('parseModelVerdicts: malformed / empty / non-JSON → [] (never throws)', () => {
  assert.deepEqual(parseModelVerdicts('not json at all'), []);
  assert.deepEqual(parseModelVerdicts(''), []);
  assert.deepEqual(parseModelVerdicts('   '), []);
  assert.deepEqual(parseModelVerdicts('{"verdicts": "oops"}'), []); // wrong type
  assert.deepEqual(parseModelVerdicts('{broken'), []);
});

// ─── scoreVerdicts (safe-default + threshold behavior) ────────────────────────────────
test('scoreVerdicts: supported requires supported:true AND score ≥ threshold', () => {
  const claims = ['c0', 'c1', 'c2'];
  const res = scoreVerdicts(
    claims,
    [
      { index: 0, supported: true, score: 0.9, source: 'S1' }, // clear support
      { index: 1, supported: true, score: 0.2 }, // says true but low confidence → NOT supported
      { index: 2, supported: false, score: 0.9 }, // high score but false → NOT supported
    ],
    0,
  );
  assert.equal(res.verdicts[0].supported, true);
  assert.equal(res.verdicts[0].source, 'S1');
  assert.equal(res.verdicts[1].supported, false);
  assert.equal(res.verdicts[2].supported, false);
  assert.equal(res.score, Math.round((1 / 3) * 100)); // 33
});

test('scoreVerdicts: a MISSING verdict fails closed (unsupported, score 0)', () => {
  const res = scoreVerdicts(['c0', 'c1'], [{ index: 0, supported: true, score: 0.8 }], 0);
  assert.equal(res.verdicts.length, 2);
  assert.equal(res.verdicts[1].supported, false); // no verdict for claim 1 → safe default
  assert.equal(res.verdicts[1].score, 0);
});

test('scoreVerdicts: garbage fields clamp safely (out-of-range / non-numeric score)', () => {
  const res = scoreVerdicts(
    ['c0', 'c1', 'c2'],
    [
      { index: 0, supported: true, score: 5 }, // >1 clamps to 1 → supported
      { index: 1, supported: true, score: 'abc' }, // non-numeric → 0, but supported:true earns threshold credit
      { index: 2, supported: false, score: 0.99 }, // false with a high score never counts as support
    ],
    0,
  );
  assert.equal(res.verdicts[0].supported, true);
  assert.equal(res.verdicts[0].score, 1);
  // supported:true with unusable score → credited at threshold (0.5) so it isn't silently dropped
  assert.equal(res.verdicts[1].score, 0.5);
  assert.equal(res.verdicts[1].supported, true);
  assert.equal(res.verdicts[2].supported, false);
});

test('scoreVerdicts: empty claims → score 0, no verdicts; truncation surfaced', () => {
  assert.deepEqual(scoreVerdicts([], [], 0), { score: 0, verdicts: [], truncated: undefined });
  assert.equal(scoreVerdicts(['c'], [], 3).truncated, 3);
});

// ─── verifyWithModel — the full pure pipeline with an injected fake model ───────────────
function fakeModel(reply: string): EntailmentModel {
  return async () => reply;
}

test('THE PARAPHRASE CASE: an entailed paraphrase scores SUPPORTED (lexical would score 0)', async () => {
  // Claim shares almost no tokens with the source — token overlap ≈ 0. The lexical floor would
  // mark this unsupported. The model judges it entailed, so the model adapter marks it supported.
  const answer = 'The central bank sets the cost of borrowing for lenders.';
  const sources: GroundingSource[] = [
    { id: 'S1', text: 'The Reserve Bank of India determines the repo rate for the banking system.' },
  ];
  const res = await verifyWithModel(
    answer,
    sources,
    fakeModel('{"verdicts":[{"index":0,"supported":true,"score":0.88,"source":"S1"}]}'),
  );
  assert.equal(res.verdicts.length, 1);
  assert.equal(res.verdicts[0].supported, true, 'entailed paraphrase must be supported');
  assert.equal(res.verdicts[0].score, 0.88);
  assert.equal(res.verdicts[0].source, 'S1');
  assert.equal(res.score, 100);
});

test('verifyWithModel: a genuinely unsupported claim is marked unsupported', async () => {
  const res = await verifyWithModel(
    'The Eiffel Tower is in Paris.',
    [{ id: 'S1', text: 'Mumbai is the financial capital of India.' }],
    fakeModel('{"verdicts":[{"index":0,"supported":false,"score":0.05}]}'),
  );
  assert.equal(res.verdicts[0].supported, false);
  assert.equal(res.score, 0);
});

test('verifyWithModel: mixed multi-claim answer aggregates per claim', async () => {
  const res = await verifyWithModel(
    'Mumbai is the financial capital. The moon is made of cheese.',
    [{ id: 'S1', text: 'Mumbai is India\'s financial capital.' }],
    fakeModel(
      '{"verdicts":[{"index":0,"supported":true,"score":0.9,"source":"S1"},{"index":1,"supported":false,"score":0.0}]}',
    ),
  );
  assert.equal(res.verdicts.length, 2);
  assert.equal(res.verdicts[0].supported, true);
  assert.equal(res.verdicts[1].supported, false);
  assert.equal(res.score, 50);
});

test('verifyWithModel: empty answer → no claims, zero score', async () => {
  const res = await verifyWithModel('', [{ text: 'anything' }], fakeModel('{"verdicts":[]}'));
  assert.deepEqual(res.verdicts, []);
  assert.equal(res.score, 0);
});

test('verifyWithModel: >MAX_CLAIMS (12) sentences → capped verdicts + truncated overflow', async () => {
  const answer = Array.from({ length: 15 }, (_, i) => `Sentence ${i}.`).join(' ');
  // Model echoes 12 supported verdicts (indices 0..11).
  const verdicts = Array.from({ length: 12 }, (_, i) => `{"index":${i},"supported":true,"score":0.9}`).join(',');
  const res = await verifyWithModel(answer, [{ text: 'source' }], fakeModel(`{"verdicts":[${verdicts}]}`));
  assert.equal(res.verdicts.length, 12);
  assert.equal(res.truncated, 3);
  assert.equal(res.score, 100);
});

test('verifyWithModel: malformed model output → all claims fail closed (no fabricated support)', async () => {
  const res = await verifyWithModel(
    'A claim that the model garbles the answer for.',
    [{ text: 'source' }],
    fakeModel('the model returned prose, not JSON'),
  );
  assert.equal(res.verdicts.length, 1);
  assert.equal(res.verdicts[0].supported, false); // safe default, not a fake pass
  assert.equal(res.score, 0);
});

// ─── makeModelGrounding — adapter-level fallback to the lexical floor ─────────────────────
test('makeModelGrounding: model THROWS → falls back to the lexical floor (honest, still returns)', async () => {
  const throwingModel: EntailmentModel = async () => {
    throw new Error('gateway unreachable');
  };
  const adapter = makeModelGrounding(throwingModel);
  // This claim has HIGH token overlap with the source, so the lexical floor supports it — proving
  // the fallback actually ran the lexical adapter (not a zeroed-out error result).
  const res = await adapter.verify('The Reserve Bank of India sets the repo rate.', [
    { id: 'S1', text: 'The Reserve Bank of India sets the repo rate for the banking system.' },
  ]);
  assert.equal(res.verdicts[0].supported, true);
  assert.equal(res.score, 100);
});

test('makeModelGrounding: meta id is "model" (selected by OFFGRID_ADAPTER_GROUNDING=model)', () => {
  const adapter = makeModelGrounding(fakeModel('{"verdicts":[]}'));
  assert.equal(adapter.meta.id, 'model');
  assert.equal(adapter.meta.capability, 'grounding');
});

test('makeModelGrounding: happy path returns the model verdict (paraphrase supported end-to-end)', async () => {
  const adapter = makeModelGrounding(
    fakeModel('{"verdicts":[{"index":0,"supported":true,"score":0.8,"source":"S1"}]}'),
  );
  const res = await adapter.verify('Borrowing costs are set by the monetary authority.', [
    { id: 'S1', text: 'The RBI fixes the repo rate.' },
  ]);
  assert.equal(res.verdicts[0].supported, true);
  assert.equal(res.score, 100);
});
