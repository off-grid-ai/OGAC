import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  orgMemberEmailSet,
  scopeKeycloakUsersToOrg,
} from '../src/lib/user-scope.ts';

// PURE unit tests for the Access → Users tab tenant isolation (SURFACE-1). No I/O. The realm-wide
// Keycloak list is intersected with the caller org's DB members, so a tenant sees ONLY its own
// users — never a sibling tenant's user or internal staff.

// A realm as QA observed it on the insurer (org_suraksha) console: the insurer's own viewer, the
// BANK's demo user, and internal @wednesday.is staff — all realm-wide.
const REALM = [
  { id: 'u1', username: 'viewer@suraksha.demo', email: 'viewer@suraksha.demo', enabled: true },
  { id: 'u2', username: 'bharat.demo', email: 'viewer@bharatunion.demo', enabled: true }, // the bank
  { id: 'u3', username: 'mac', email: 'mac@wednesday.is', enabled: true }, // internal staff
  { id: 'u4', username: 'admin@suraksha.example', email: 'admin@suraksha.example', enabled: true },
];

// ─── orgMemberEmailSet ───────────────────────────────────────────────────────────
test('orgMemberEmailSet: lowercases, trims, drops blanks', () => {
  const set = orgMemberEmailSet([
    { email: 'Viewer@Suraksha.Demo' },
    { email: '  admin@suraksha.example  ' },
    { email: '' },
    { email: null },
    {},
  ]);
  assert.deepEqual([...set].sort(), ['admin@suraksha.example', 'viewer@suraksha.demo']);
});

// ─── scopeKeycloakUsersToOrg — the terminal list the Users tab renders ────────────
test('ISOLATION: org_suraksha sees ONLY its own users — never the bank or internal staff', () => {
  // The DB says org_suraksha has exactly these two members.
  const orgEmails = orgMemberEmailSet([
    { email: 'viewer@suraksha.demo' },
    { email: 'admin@suraksha.example' },
  ]);
  const rendered = scopeKeycloakUsersToOrg(REALM, orgEmails, true);
  const emails = rendered.map((u) => u.email).sort();

  assert.deepEqual(emails, ['admin@suraksha.example', 'viewer@suraksha.demo']);
  // The exact leaking rows QA saw are ABSENT.
  assert.ok(!rendered.some((u) => u.email === 'viewer@bharatunion.demo'), 'no bank user');
  assert.ok(!rendered.some((u) => u.email === 'mac@wednesday.is'), 'no internal staff');
});

test('ISOLATION symmetry: org_bharat sees only the bank user, not the insurer', () => {
  const orgEmails = orgMemberEmailSet([{ email: 'viewer@bharatunion.demo' }]);
  const rendered = scopeKeycloakUsersToOrg(REALM, orgEmails, true);
  assert.deepEqual(rendered.map((u) => u.email), ['viewer@bharatunion.demo']);
  assert.ok(!rendered.some((u) => u.email?.includes('suraksha')), 'no insurer user');
});

test('case-insensitive + username fallback when email is absent', () => {
  const users = [
    { id: 'a', username: 'ALICE@X.COM', email: undefined },
    { id: 'b', username: 'bob', email: 'BOB@x.com' },
    { id: 'c', username: 'carol@x.com', email: null },
  ];
  const orgEmails = orgMemberEmailSet([{ email: 'alice@x.com' }, { email: 'bob@x.com' }]);
  const rendered = scopeKeycloakUsersToOrg(users, orgEmails, true);
  assert.deepEqual(rendered.map((u) => u.id), ['a', 'b'], 'matched via username fallback + email, ci');
});

test('a realm user with no org membership is dropped (no orphan leak)', () => {
  const orgEmails = orgMemberEmailSet([{ email: 'viewer@suraksha.demo' }]);
  const rendered = scopeKeycloakUsersToOrg(REALM, orgEmails, true);
  assert.deepEqual(rendered.map((u) => u.email), ['viewer@suraksha.demo']);
});

test('empty org membership → empty list (a tenant with no DB members sees nobody, not everyone)', () => {
  const rendered = scopeKeycloakUsersToOrg(REALM, new Set<string>(), true);
  assert.deepEqual(rendered, [], 'scoped with no members returns nobody — never the whole realm');
});

// ─── single-tenant / default org: unchanged behaviour ────────────────────────────
test('scoped:false (default/single-tenant org) returns the realm list unchanged', () => {
  const rendered = scopeKeycloakUsersToOrg(REALM, new Set<string>(), false);
  assert.equal(rendered.length, REALM.length, 'realm is the tenant — no intersection');
  assert.deepEqual(rendered.map((u) => u.id), ['u1', 'u2', 'u3', 'u4']);
  // Returns a COPY, not the same array reference (callers may mutate/paginate).
  assert.notEqual(rendered, REALM);
});
