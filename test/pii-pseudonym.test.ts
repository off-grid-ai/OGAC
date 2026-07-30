import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizeEntityValue,
  stablePseudonym,
  stabilizePseudonyms,
  tokenRuns,
} from '../src/lib/pii-pseudonym.ts';
import { maskOrBlock } from '../src/lib/pii-escalation.ts';

// ── GAP M1 — masking must not destroy entity identity ──────────────────────────────────────────────
//
// From run apprun_a60fcc2f: the app read the right data and the agent still refused, because one person
// carried three different tokens across the run's channels. These tests pin the property that fixes it
// (same value ⇒ same token, always) and the safety invariant that keeps it honest (any alignment doubt
// ⇒ return the REDACTED text, never the original).

const ORG = 'org_bharat';

describe('stablePseudonym', () => {
  test('THE property: the same value yields the same token, every time', () => {
    const a = stablePseudonym('PERSON', 'Meera Malhotra', ORG);
    const b = stablePseudonym('PERSON', 'Meera Malhotra', ORG);
    assert.equal(a, b);
  });

  test('different values yield different tokens', () => {
    assert.notEqual(
      stablePseudonym('PERSON', 'Meera Malhotra', ORG),
      stablePseudonym('PERSON', 'Manish Pillai', ORG),
    );
  });

  test('agrees across case and whitespace — that is the join the agent needs', () => {
    const canonical = stablePseudonym('PERSON', 'Meera Malhotra', ORG);
    for (const variant of ['meera malhotra', 'MEERA MALHOTRA', '  Meera   Malhotra  ']) {
      assert.equal(stablePseudonym('PERSON', variant, ORG), canonical, variant);
    }
  });

  test('is salted per org, so nothing correlates across tenants', () => {
    assert.notEqual(
      stablePseudonym('PERSON', 'Meera Malhotra', 'org_bharat'),
      stablePseudonym('PERSON', 'Meera Malhotra', 'org_suraksha'),
    );
  });

  test('keeps the entity type readable and never emits the raw value', () => {
    const t = stablePseudonym('PERSON', 'Meera Malhotra', ORG);
    assert.match(t, /^\[PERSON_[0-9a-f]{8}\]$/);
    assert.ok(!t.toLowerCase().includes('meera'));
  });

  test('the same value under different types stays distinguishable', () => {
    assert.notEqual(stablePseudonym('PERSON', '4111', ORG), stablePseudonym('CARD', '4111', ORG));
  });
});

describe('tokenRuns', () => {
  test('groups ADJACENT placeholders into one run — the split-name case', () => {
    // The live output: one name split across two placeholders. There is no way to know where the first
    // value ended, so the run is one entity — and a full name as a single token is what we want anyway.
    const runs = tokenRuns('claim for [REDACTED_PERSON_12][REDACTED_PERSON_13] today');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].type, 'PERSON');
  });

  test('keeps separated placeholders distinct', () => {
    assert.equal(tokenRuns('[REDACTED_PERSON_1] paid [REDACTED_PERSON_2]').length, 2);
  });

  test('handles the bare and unnumbered forms', () => {
    assert.equal(tokenRuns('pan [REDACTED] here').length, 1);
    assert.equal(tokenRuns('mail [REDACTED_EMAIL_ADDRESS] here')[0].type, 'EMAIL_ADDRESS');
  });

  test('no placeholders means no runs', () => {
    assert.deepEqual(tokenRuns('nothing to see'), []);
  });
});

describe('stabilizePseudonyms', () => {
  test('THE live defect: three tokens for one person collapse to one', () => {
    const original = 'The claim by Meera Malhotra. The only claim is for Meera Malhotra, not Meera Malhotra.';
    const redacted =
      'The claim by [REDACTED_PERSON_23]. The only claim is for [REDACTED_PERSON_12], not [REDACTED_PERSON_7].';
    const out = stabilizePseudonyms(original, redacted, ORG);
    const tokens = [...out.matchAll(/\[PERSON_[0-9a-f]{8}\]/g)].map((m) => m[0]);
    assert.equal(tokens.length, 3);
    assert.equal(new Set(tokens).size, 1, `all three must be the same token, got ${out}`);
    // And the name itself must not have come back.
    assert.ok(!out.includes('Meera'));
  });

  test('the same person is the same token across SEPARATE scans — the actual failure mode', () => {
    // Two independent scans, each with its own counter. This is the run's two channels.
    const caseChannel = stabilizePseudonyms(
      'submitted by Meera Malhotra',
      'submitted by [REDACTED_PERSON_23]',
      ORG,
    );
    const sourceChannel = stabilizePseudonyms(
      'employee_name: Meera Malhotra, category: Training',
      'employee_name: [REDACTED_PERSON_4], category: Training',
      ORG,
    );
    const t1 = caseChannel.match(/\[PERSON_[0-9a-f]{8}\]/)?.[0];
    const t2 = sourceChannel.match(/\[PERSON_[0-9a-f]{8}\]/)?.[0];
    assert.ok(t1 && t2);
    assert.equal(t1, t2, 'the agent must be able to join these two records');
  });

  test('distinct people keep distinct tokens', () => {
    const out = stabilizePseudonyms(
      'Meera Malhotra and Manish Pillai',
      '[REDACTED_PERSON_1] and [REDACTED_PERSON_2]',
      ORG,
    );
    const tokens = [...out.matchAll(/\[PERSON_[0-9a-f]{8}\]/g)].map((m) => m[0]);
    assert.equal(new Set(tokens).size, 2);
  });

  test('an adjacent pair becomes ONE token for the whole name', () => {
    const out = stabilizePseudonyms(
      'claim for Meera Malhotra today',
      'claim for [REDACTED_PERSON_12][REDACTED_PERSON_13] today',
      ORG,
    );
    assert.equal([...out.matchAll(/\[PERSON_[0-9a-f]{8}\]/g)].length, 1);
    assert.match(out, /^claim for \[PERSON_[0-9a-f]{8}\] today$/);
    assert.ok(!out.includes('Meera'));
  });

  test('a placeholder at the very start and end aligns', () => {
    const out = stabilizePseudonyms('Meera Malhotra owes 500', '[REDACTED_PERSON_1] owes 500', ORG);
    assert.match(out, /^\[PERSON_[0-9a-f]{8}\] owes 500$/);
    const tail = stabilizePseudonyms('owed by Meera Malhotra', 'owed by [REDACTED_PERSON_1]', ORG);
    assert.match(tail, /^owed by \[PERSON_[0-9a-f]{8}\]$/);
  });

  test('mixed entity types each keep their own readable prefix', () => {
    const out = stabilizePseudonyms(
      'Meera Malhotra at meera@bank.in',
      '[REDACTED_PERSON_1] at [REDACTED_EMAIL_ADDRESS_1]',
      ORG,
    );
    assert.match(out, /\[PERSON_[0-9a-f]{8}\] at \[EMAIL_ADDRESS_[0-9a-f]{8}\]/);
  });

  test('text with no placeholders passes through untouched', () => {
    assert.equal(stabilizePseudonyms('nothing here', 'nothing here', ORG), 'nothing here');
  });

  // ── THE SAFETY INVARIANT: any doubt ⇒ the redacted text, never the original ──
  test('a literal that does not align returns the REDACTED text, never raw', () => {
    const original = 'The claim by Meera Malhotra.';
    const redacted = 'A totally different sentence with [REDACTED_PERSON_1] in it.';
    const out = stabilizePseudonyms(original, redacted, ORG);
    assert.equal(out, redacted);
    assert.ok(!out.includes('Meera'), 'a mis-alignment must never leak the value');
  });

  test('a mismatched tail returns the redacted text', () => {
    const out = stabilizePseudonyms('Meera Malhotra owes 500', '[REDACTED_PERSON_1] owes 999', ORG);
    assert.equal(out, '[REDACTED_PERSON_1] owes 999');
  });

  test('a placeholder standing for nothing returns the redacted text', () => {
    // Same text on both sides plus a token ⇒ the token replaced an empty span ⇒ we mis-read it.
    const out = stabilizePseudonyms('owes 500', '[REDACTED_PERSON_1]owes 500', ORG);
    assert.equal(out, '[REDACTED_PERSON_1]owes 500');
  });

  test('an empty original can never produce a value', () => {
    assert.equal(stabilizePseudonyms('', '[REDACTED_PERSON_1]', ORG), '[REDACTED_PERSON_1]');
  });

  test('never emits the original text on ANY input pairing', () => {
    // Adversarial sweep: whatever the pairing, the raw name must not survive into the output.
    const pairs: [string, string][] = [
      ['Meera Malhotra', '[REDACTED_PERSON_1]'],
      ['Meera Malhotra paid', '[REDACTED_PERSON_1] paid'],
      ['Meera Malhotra paid', 'mismatch [REDACTED_PERSON_1]'],
      ['Meera Malhotra', '[REDACTED_PERSON_1][REDACTED_PERSON_2]'],
      ['a Meera Malhotra b', 'a [REDACTED_PERSON_1] b'],
      ['x', '[REDACTED]'],
    ];
    for (const [original, redacted] of pairs) {
      const out = stabilizePseudonyms(original, redacted, ORG);
      assert.ok(!out.includes('Meera'), `leaked on ${JSON.stringify([original, redacted])}: ${out}`);
    }
  });
});

describe('normalizeEntityValue', () => {
  test('collapses case and whitespace only', () => {
    assert.equal(normalizeEntityValue('  Meera   MALHOTRA '), 'meera malhotra');
    // Punctuation is meaningful in identifiers (PAN, IFSC, emails) and must survive.
    assert.equal(normalizeEntityValue('ABCDE1234F'), 'abcde1234f');
    assert.equal(normalizeEntityValue('meera@bank.in'), 'meera@bank.in');
  });
});

// ── The cross-channel property, at the maskOrBlock seam every run path shares ────────────────────────
describe('maskOrBlock — value-stable pseudonyms across channels (GAP M1)', () => {
  const scan = (redacted: string) => ({
    ok: true as const,
    scan: { hits: true, entities: ['PERSON'], redacted, engine: 'llm-guard' },
  });

  test('one person, three independent scans, ONE token', () => {
    // Exactly the run's three channels, each with its own counter, as they arrived live.
    const channels: [string, string][] = [
      ['submitted by Meera Malhotra', 'submitted by [REDACTED_PERSON_23]'],
      ['employee_name: Meera Malhotra', 'employee_name: [REDACTED_PERSON_4]'],
      ['claim for Meera Malhotra today', 'claim for [REDACTED_PERSON_12][REDACTED_PERSON_13] today'],
    ];
    const tokens = channels.map(([raw, redacted]) => {
      const d = maskOrBlock(true, raw, scan(redacted), 'org_bharat');
      assert.equal(d.block, false);
      return d.text.match(/\[PERSON_[0-9a-f]{8}\]/)?.[0];
    });
    assert.ok(tokens.every(Boolean), JSON.stringify(tokens));
    assert.equal(new Set(tokens).size, 1, `must be one token, got ${JSON.stringify(tokens)}`);
  });

  test('without a salt, behaviour is exactly as before — additive, never a silent change', () => {
    const d = maskOrBlock(true, 'submitted by Meera Malhotra', scan('submitted by [REDACTED_PERSON_23]'));
    assert.equal(d.text, 'submitted by [REDACTED_PERSON_23]');
  });

  test('the fail-closed paths still win over pseudonymisation', () => {
    // A masker that could not screen must BLOCK, salt or no salt — re-keying must never rescue a
    // fail-closed verdict into something forwardable.
    const blocked = maskOrBlock(
      true,
      'Meera Malhotra',
      { ok: true, scan: { hits: false, entities: [], engine: 'llm-guard', blocked: true } },
      'org_bharat',
    );
    assert.equal(blocked.block, true);
    const threw = maskOrBlock(true, 'Meera Malhotra', { ok: false, error: new Error('down') }, 'org_bharat');
    assert.equal(threw.block, true);
  });

  test('masking not required leaves the text alone even with a salt', () => {
    const d = maskOrBlock(false, 'Meera Malhotra', scan('[REDACTED_PERSON_1]'), 'org_bharat');
    assert.equal(d.text, 'Meera Malhotra');
    assert.equal(d.masked, false);
  });
});
