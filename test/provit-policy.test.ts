import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abacAllows, canSee, pushVisibility, type ProvitAbacRule } from '../src/lib/provit-policy.ts';

// Unit tests for the PURE Provit access policy — NO mocks, NO DB, NO network. These exercise the
// exact decision logic that provit-access.ts feeds DB/session inputs into, so the SQL filter and
// the ABAC gate are guaranteed to share one source of truth.

// ---------------------------------------------------------------------------
// pushVisibility: token → private/org data; no token → free public showcase.
// ---------------------------------------------------------------------------
test('pushVisibility: an org token makes the push org-visible (paid/private)', () => {
  assert.equal(pushVisibility(true), 'org');
});

test('pushVisibility: no token → public showcase (free funnel)', () => {
  assert.equal(pushVisibility(false), 'public');
});

// ---------------------------------------------------------------------------
// abacAllows: deny-overrides, fail-open when no rule governs.
// ---------------------------------------------------------------------------
const rule = (o: Partial<ProvitAbacRule>): ProvitAbacRule => ({
  role: 'viewer', resource: 'provit', attribute: 'action', operator: 'eq', value: 'read', effect: 'allow', ...o,
});

test('abacAllows: no rules at all → allowed (RBAC gate already applied)', () => {
  assert.equal(abacAllows([], 'viewer', 'read'), true);
});

test('abacAllows: no MATCHING rule → allowed (fail-open refinement)', () => {
  // Rule governs a different action; nothing matches read → allowed.
  const rules = [rule({ value: 'write', effect: 'deny' })];
  assert.equal(abacAllows(rules, 'viewer', 'read'), true);
});

test('abacAllows: a matching allow → allowed', () => {
  assert.equal(abacAllows([rule({ effect: 'allow' })], 'viewer', 'read'), true);
});

test('abacAllows: a matching deny → denied', () => {
  assert.equal(abacAllows([rule({ effect: 'deny' })], 'viewer', 'read'), false);
});

test('abacAllows: deny-overrides — allow + deny on same request → denied', () => {
  const rules = [rule({ effect: 'allow' }), rule({ effect: 'deny' })];
  assert.equal(abacAllows(rules, 'viewer', 'read'), false);
});

test('abacAllows: matched but ONLY non-allow/non-deny effects → denied (governing rule, no grant)', () => {
  // A rule governs this request but grants nothing → the caller is not allowed.
  const rules = [rule({ effect: 'audit' })];
  assert.equal(abacAllows(rules, 'viewer', 'read'), false);
});

test('abacAllows: wildcard role (*) matches any role', () => {
  assert.equal(abacAllows([rule({ role: '*', effect: 'deny' })], 'editor', 'read'), false);
});

test('abacAllows: wildcard resource (*) matches provit', () => {
  assert.equal(abacAllows([rule({ resource: '*', effect: 'deny' })], 'viewer', 'read'), false);
});

test('abacAllows: rule for a different role does not apply', () => {
  const rules = [rule({ role: 'editor', effect: 'deny' })];
  assert.equal(abacAllows(rules, 'viewer', 'read'), true);
});

test('abacAllows: rule for a different resource does not apply', () => {
  const rules = [rule({ resource: 'chat', effect: 'deny' })];
  assert.equal(abacAllows(rules, 'viewer', 'read'), true);
});

test('abacAllows: operator "in" matches when action is in the CSV list', () => {
  const rules = [rule({ operator: 'in', value: 'read,write,delete', effect: 'deny' })];
  assert.equal(abacAllows(rules, 'viewer', 'write'), false);
  assert.equal(abacAllows(rules, 'viewer', 'archive'), true); // not in list → no match → allowed
});

test('abacAllows: operator "neq" matches when action differs from value', () => {
  // deny everything that is NOT read → write is denied, read is allowed (no match).
  const rules = [rule({ operator: 'neq', value: 'read', effect: 'deny' })];
  assert.equal(abacAllows(rules, 'viewer', 'write'), false);
  assert.equal(abacAllows(rules, 'viewer', 'read'), true);
});

test('abacAllows: rule keyed on a non-action attribute never matches (Provit only supplies action)', () => {
  const rules = [rule({ attribute: 'department', value: 'read', effect: 'deny' })];
  assert.equal(abacAllows(rules, 'viewer', 'read'), true);
});

// ---------------------------------------------------------------------------
// canSee: the visibilityFilter truth table (public ∪ own-org ∪ own-private).
// ---------------------------------------------------------------------------
const viewer = { orgId: 'acme', email: 'sam@acme.com' };

test('canSee: public rows are visible to anyone', () => {
  assert.equal(canSee({ visibility: 'public', orgId: 'other', ownerId: 'x@y.com' }, viewer), true);
});

test('canSee: org rows visible only to same-org viewers', () => {
  assert.equal(canSee({ visibility: 'org', orgId: 'acme', ownerId: 'x@y.com' }, viewer), true);
  assert.equal(canSee({ visibility: 'org', orgId: 'other', ownerId: 'x@y.com' }, viewer), false);
});

test('canSee: private rows visible only to the owner (by email)', () => {
  assert.equal(canSee({ visibility: 'private', orgId: 'acme', ownerId: 'sam@acme.com' }, viewer), true);
  assert.equal(canSee({ visibility: 'private', orgId: 'acme', ownerId: 'other@acme.com' }, viewer), false);
});

test('canSee: private is owner-scoped, NOT org-scoped (same org, different owner → hidden)', () => {
  assert.equal(canSee({ visibility: 'private', orgId: 'acme', ownerId: 'boss@acme.com' }, viewer), false);
});

test('canSee: unknown visibility → not visible (fail-closed)', () => {
  assert.equal(canSee({ visibility: 'secret', orgId: 'acme', ownerId: 'sam@acme.com' }, viewer), false);
});

test('canSee: full access matrix across visibilities and viewers', () => {
  const rows = [
    { visibility: 'public', orgId: 'acme', ownerId: 'sam@acme.com' },
    { visibility: 'org', orgId: 'acme', ownerId: 'sam@acme.com' },
    { visibility: 'org', orgId: 'beta', ownerId: 'lee@beta.com' },
    { visibility: 'private', orgId: 'acme', ownerId: 'sam@acme.com' },
    { visibility: 'private', orgId: 'beta', ownerId: 'lee@beta.com' },
  ];
  const sam = { orgId: 'acme', email: 'sam@acme.com' };
  const lee = { orgId: 'beta', email: 'lee@beta.com' };
  assert.deepEqual(rows.map((r) => canSee(r, sam)), [true, true, false, true, false]);
  assert.deepEqual(rows.map((r) => canSee(r, lee)), [true, false, true, false, true]);
});
