import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveDomain,
  resolveDomainRanked,
  type DataDomain,
} from '../src/lib/data-domains.ts';

// PURE unit tests for the connector rule engine's resolver. Correctness IS the product promise
// (Builder Epic risk #2): a wrong binding silently reads the wrong system. These prove the resolver
// is deterministic, no-guess (null when unsure), and handles case/whitespace/plural/alias forms.

// ─── fixture — a realistic org declaration set ───────────────────────────────────
const HR: DataDomain = {
  id: 'dom_hr',
  orgId: 'default',
  label: 'Employee Quota',
  aliases: ['reimbursement quota', 'quota', 'expense limit'],
  connectorId: 'con_hr',
  resource: 'employee_quota',
};
const S3: DataDomain = {
  id: 'dom_s3',
  orgId: 'default',
  label: 'Invoices',
  aliases: ['billing documents', 'invoice archive'],
  connectorId: 'con_s3',
  resource: 'invoices',
};
const TXN: DataDomain = {
  id: 'dom_txn',
  orgId: 'default',
  label: 'Transactions',
  aliases: ['payments', 'ledger'],
  connectorId: 'con_pg',
  resource: 'transactions',
};
const ALL = [HR, S3, TXN];

// ─── exact + alias + plural resolution (the core promise) ────────────────────────
test('exact label resolves to its domain', () => {
  assert.equal(resolveDomain('Employee Quota', ALL)?.id, 'dom_hr');
});

test('alias "reimbursement quota" resolves to the HR domain', () => {
  assert.equal(resolveDomain('reimbursement quota', ALL)?.id, 'dom_hr');
});

test('single-word alias "quota" resolves to the HR domain', () => {
  assert.equal(resolveDomain('quota', ALL)?.id, 'dom_hr');
});

test('"invoices" resolves to the S3 domain', () => {
  assert.equal(resolveDomain('invoices', ALL)?.id, 'dom_s3');
});

test('singular "invoice" resolves to the S3 domain (plural-insensitive)', () => {
  assert.equal(resolveDomain('invoice', ALL)?.id, 'dom_s3');
});

test('plural of a label "transactions" ≡ "transaction"', () => {
  assert.equal(resolveDomain('transaction', ALL)?.id, 'dom_txn');
  assert.equal(resolveDomain('transactions', ALL)?.id, 'dom_txn');
});

// ─── case / whitespace insensitivity ─────────────────────────────────────────────
test('case-insensitive', () => {
  assert.equal(resolveDomain('EMPLOYEE QUOTA', ALL)?.id, 'dom_hr');
  assert.equal(resolveDomain('employee quota', ALL)?.id, 'dom_hr');
});

test('whitespace/punctuation-insensitive', () => {
  assert.equal(resolveDomain('  employee   quota!! ', ALL)?.id, 'dom_hr');
});

// ─── phrase embedding (tier 3/4) ─────────────────────────────────────────────────
test('a query that embeds a domain phrase resolves it', () => {
  assert.equal(resolveDomain('please check the employee quota for me', ALL)?.id, 'dom_hr');
});

test('a query embedding an alias resolves it', () => {
  assert.equal(resolveDomain('what is the reimbursement quota this year', ALL)?.id, 'dom_hr');
});

// ─── no-guess: unknown / ambiguous / empty → null ────────────────────────────────
test('unknown phrase → null (never guess)', () => {
  assert.equal(resolveDomain('the weather forecast tomorrow', ALL), null);
});

test('empty phrase → null', () => {
  assert.equal(resolveDomain('', ALL), null);
  assert.equal(resolveDomain('   ', ALL), null);
});

test('no domains → null', () => {
  assert.equal(resolveDomain('quota', []), null);
});

test('short noise token does not bind ("a", "of")', () => {
  assert.equal(resolveDomain('of', ALL), null);
});

test('two domains matching the SAME phrase exactly → null (ambiguous, no-guess)', () => {
  const a: DataDomain = { ...HR, id: 'dom_a', connectorId: 'con_a' };
  const b: DataDomain = { ...HR, id: 'dom_b', connectorId: 'con_b', label: 'Something Else', aliases: ['quota'] };
  // Both answer to exactly "quota" via alias → genuine ambiguity.
  assert.equal(resolveDomain('quota', [a, b]), null);
});

test('an exact match wins even when another domain fuzzily matches', () => {
  // "payments" is TXN's exact alias; nothing else matches exactly → TXN binds.
  assert.equal(resolveDomain('payments', ALL)?.id, 'dom_txn');
});

// ─── determinism ─────────────────────────────────────────────────────────────────
test('deterministic: same inputs → same output across many runs', () => {
  const first = resolveDomain('employee quota', ALL)?.id;
  for (let i = 0; i < 50; i += 1) {
    assert.equal(resolveDomain('employee quota', ALL)?.id, first);
  }
});

test('deterministic regardless of domain array order', () => {
  const forward = resolveDomain('invoices', [HR, S3, TXN])?.id;
  const reversed = resolveDomain('invoices', [TXN, S3, HR])?.id;
  assert.equal(forward, 'dom_s3');
  assert.equal(reversed, 'dom_s3');
});

// ─── resolveDomainRanked — candidate surfacing ───────────────────────────────────
test('resolveDomainRanked returns candidates best-first with scores', () => {
  const ranked = resolveDomainRanked('employee quota', ALL);
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].domain.id, 'dom_hr');
  assert.equal(ranked[0].score, 1.0, 'exact label = 1.0');
});

test('resolveDomainRanked scores are descending', () => {
  const ranked = resolveDomainRanked('quota invoices', ALL);
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, 'non-increasing scores');
  }
});

test('resolveDomainRanked omits zero-score domains', () => {
  const ranked = resolveDomainRanked('invoices', ALL);
  assert.ok(ranked.every((r) => r.score > 0));
  assert.ok(ranked.some((r) => r.domain.id === 'dom_s3'));
});

test('resolveDomainRanked empty query → []', () => {
  assert.deepEqual(resolveDomainRanked('', ALL), []);
});

// ─── stability of tie-break by id ────────────────────────────────────────────────
test('equal fuzzy scores break ties stably by id in ranked output', () => {
  const x: DataDomain = { id: 'dom_x', orgId: 'default', label: 'alpha beta', aliases: [], connectorId: 'c', resource: 'r' };
  const y: DataDomain = { id: 'dom_y', orgId: 'default', label: 'alpha beta', aliases: [], connectorId: 'c', resource: 'r' };
  const ranked = resolveDomainRanked('alpha beta gamma', [y, x]);
  // Same score → id asc → dom_x first regardless of input order.
  assert.equal(ranked[0].domain.id, 'dom_x');
});
