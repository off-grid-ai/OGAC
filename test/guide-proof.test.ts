// The proof list is what an investor or buyer reads first, so its failure behaviour matters more than
// its happy path: a single invented number costs the credibility of the other four.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProofPoints, hasAnyProof, type ProofInput } from '@/lib/guide-proof';

const FULL: ProofInput = {
  runsCompleted: 1240,
  casesWaiting: 9,
  egressTotal: 18,
  egressProtected: 4,
  signedRecords: 50,
  auditEvents: 1051,
  localShare: 0.97,
  valueSaved: '₹5,625',
  aiCost: '₹1',
};

test('an unreadable source yields null, never a zero', () => {
  // A zero is a CLAIM — "nothing was blocked" — and stating it when the truth is "we could not ask"
  // is exactly the dishonesty this surface exists to avoid.
  const points = buildProofPoints({});
  assert.ok(points.every((p) => p.value === null), 'no figure may be invented from missing input');
  assert.ok(points.every((p) => !/\b0\b/.test(String(p.value))), 'null must not become 0');
});

test('a claim with no figure still appears, rather than quietly disappearing', () => {
  // Hiding the claim you cannot evidence is how a proof list becomes marketing.
  assert.equal(buildProofPoints({}).length, buildProofPoints(FULL).length);
});

test('every point carries a place to go and check it', () => {
  for (const p of buildProofPoints(FULL)) {
    assert.match(p.href, /^\//, `${p.id} needs a real route`);
    assert.ok(p.linkLabel.trim().length > 0, `${p.id} needs a link label`);
    assert.ok(p.claim.trim().length > 0);
  }
});

test('"is it real" comes first — nothing else is worth reading until it is settled', () => {
  assert.equal(buildProofPoints(FULL)[0].id, 'real');
});

test('figures are grouped for an Indian reader', () => {
  const real = buildProofPoints({ runsCompleted: 1240000 })[0];
  assert.equal(real.value, '12,40,000', 'lakh grouping, not 1,240,000');
});

test('a partial gather shows what it has and nulls the rest', () => {
  const points = buildProofPoints({ runsCompleted: 5, localShare: 1 });
  const byId = Object.fromEntries(points.map((p) => [p.id, p]));
  assert.equal(byId.real.value, '5');
  assert.equal(byId.private.value, '100%');
  assert.equal(byId.governed.value, null);
  assert.ok(hasAnyProof(points));
});

test('nothing readable at all means there is nothing to render', () => {
  assert.equal(hasAnyProof(buildProofPoints({})), false);
});

test('a missing figure shrinks the sentence rather than leaving a hole in it', () => {
  // The component hides `detail` when the headline value is null, but the OTHER figures in a sentence
  // can be missing independently — the run count can read while the waiting-cases query fails.
  for (const input of [{}, FULL, { runsCompleted: 5 }, { signedRecords: 2 }, { valueSaved: '₹5' }]) {
    for (const p of buildProofPoints(input)) {
      assert.doesNotMatch(p.detail, /\bnull\b|\bundefined\b|\bNaN\b/, `${p.id}: ${p.detail}`);
    }
  }
});

test('every proof link points at a route that exists', async () => {
  // A proof the reader cannot go and check is a slogan, and a 404 from a panel whose entire promise is
  // "go and see it for yourself" is the single most expensive bug this surface can have. Routes get
  // moved; this test is what notices.
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../src/app/(console)', import.meta.url).pathname;
  for (const p of buildProofPoints(FULL)) {
    const dir = join(root, p.href);
    assert.ok(existsSync(join(dir, 'page.tsx')), `${p.id} points at ${p.href}, which has no page`);
  }
});

test('no internal engine names reach the reader', () => {
  const text = buildProofPoints(FULL)
    .map((p) => `${p.claim} ${p.detail} ${p.linkLabel}`)
    .join(' ')
    .toLowerCase();
  for (const engine of ['opensearch', 'presidio', 'llm guard', 'openbao', 'langfuse', 'qdrant']) {
    assert.ok(!text.includes(engine), `proof copy must not name ${engine}`);
  }
});
