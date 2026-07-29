import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { qualifiedPhrases, resolveQualifiedPhrase } from '../src/lib/phrase-qualifier.ts';

// ── B3.1 — keep the qualifier the author already wrote ─────────────────────────────────────────────
//
// LIVE FINDING (2026-07-29). Compiling
//   "When an employee submits an expense claim, read the claim, check that employee's remaining
//    reimbursement quota, decide whether it is within quota, have a manager approve or reject it…"
// produced a step bound to the org's INSURANCE `claims` domain instead of `expense claims`. Both are
// declared and real; the extracted phrase was the bare word "claim", a near-exact match for the domain
// labelled "claims", so the resolver bound it outright — and correctly, on the input it was given.
//
// That is worse than a visible failure: the app compiles, validates and runs, and silently reads the
// wrong table — breaking "it inherits your data" quietly, which a non-technical author cannot be
// expected to notice.

const DESC =
  "When an employee submits an expense claim, read the claim, check that employee's remaining " +
  'reimbursement quota, decide whether it is within quota, have a manager approve or reject it.';

describe('B3.1 — qualifiedPhrases', () => {
  test('recovers "expense claim" for the bare phrase "claim"', () => {
    const candidates = qualifiedPhrases('claim', DESC);
    assert.ok(candidates.includes('expense claim'), JSON.stringify(candidates));
  });

  test('the bare phrase is always the LAST candidate, so behaviour can only be added to', () => {
    const candidates = qualifiedPhrases('claim', DESC);
    assert.equal(candidates.at(-1), 'claim');
  });

  test('more specific candidates come first', () => {
    const candidates = qualifiedPhrases('claim', DESC);
    const expense = candidates.indexOf('expense claim');
    assert.ok(expense < candidates.length - 1, 'qualified reading must outrank the bare phrase');
  });

  test('articles and verbs are never treated as qualifiers', () => {
    // "read the claim" must not yield "the claim"; "submits an expense claim" must not yield
    // "submits expense claim".
    const candidates = qualifiedPhrases('claim', DESC);
    assert.ok(!candidates.some((c) => c.startsWith('the ')), JSON.stringify(candidates));
    assert.ok(!candidates.some((c) => c.includes('submits')), JSON.stringify(candidates));
    assert.ok(!candidates.some((c) => c.startsWith('an ')), JSON.stringify(candidates));
  });

  test('a phrase the author never qualified yields only itself', () => {
    assert.deepEqual(qualifiedPhrases('invoices', 'Read the invoices and summarise them.'), [
      'invoices',
    ]);
  });

  test('an empty phrase yields nothing rather than throwing', () => {
    assert.deepEqual(qualifiedPhrases('', DESC), []);
    assert.deepEqual(qualifiedPhrases('   ', DESC), []);
  });

  test('a phrase absent from the description still returns the phrase', () => {
    assert.deepEqual(qualifiedPhrases('ledger', DESC), ['ledger']);
  });

  test('possessives and punctuation in the description do not break matching', () => {
    // "that employee's remaining reimbursement quota" — the apostrophe must not prevent a match.
    const candidates = qualifiedPhrases('reimbursement quota', DESC);
    assert.ok(candidates.includes('remaining reimbursement quota'), JSON.stringify(candidates));
  });
});

describe('B3.1 — resolveQualifiedPhrase', () => {
  // A stand-in for the real declared domains: both "claims" and "expense claims" exist, which is the
  // situation that produced the live mis-binding.
  const DOMAINS: Record<string, string> = {
    claims: 'dom_insurance_claims',
    'expense claims': 'dom_expense_claims',
    'expense claim': 'dom_expense_claims',
    'reimbursement quota': 'dom_quota',
  };
  const resolve = (candidate: string) => DOMAINS[candidate.toLowerCase()] ?? null;

  test('the qualified reading wins over the bare one', () => {
    const { resolved, matchedPhrase } = resolveQualifiedPhrase('claim', DESC, resolve);
    assert.equal(resolved, 'dom_expense_claims', 'must not bind the insurance claims domain');
    assert.equal(matchedPhrase, 'expense claim');
  });

  test('falls back to the bare phrase when no qualified reading resolves', () => {
    const { resolved, matchedPhrase } = resolveQualifiedPhrase(
      'claims',
      'Read the claims and triage them.',
      resolve,
    );
    assert.equal(resolved, 'dom_insurance_claims');
    assert.equal(matchedPhrase, 'claims');
  });

  test('an unresolvable phrase reports null and the original phrase (no guessing)', () => {
    const { resolved, matchedPhrase } = resolveQualifiedPhrase('ledger', DESC, resolve);
    assert.equal(resolved, null);
    assert.equal(matchedPhrase, 'ledger');
  });

  test('resolution uses the CALLER\'s rule for every candidate, not a private one', () => {
    const seen: string[] = [];
    resolveQualifiedPhrase('claim', DESC, (c) => {
      seen.push(c);
      return null;
    });
    // Every candidate went through the injected resolver, ending with the bare phrase.
    assert.ok(seen.includes('expense claim'));
    assert.equal(seen.at(-1), 'claim');
  });
});
