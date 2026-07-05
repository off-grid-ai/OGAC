import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aclFromPayload,
  aclIsEnforced,
  askerFrom,
  docVisibleTo,
  filterHitsByAcl,
  normalizeAcl,
  type DocAcl,
} from '../src/lib/retrieval/acl.ts';
import { buildQdrantAclShould } from '../src/lib/retrieval/query.ts';

// Unit tests for the PURE permissions-aware-retrieval policy — no mocks, no I/O (mirrors
// tenancy-policy / retrieval-query). The property under test: only docs the asker may see pass,
// and un-ACL'd docs stay visible (backward compatible).

// ── aclIsEnforced ────────────────────────────────────────────────────────────

test('aclIsEnforced: no ACL / empty ACL → not enforced (visible to all)', () => {
  assert.equal(aclIsEnforced(undefined), false);
  assert.equal(aclIsEnforced(null), false);
  assert.equal(aclIsEnforced({}), false);
  assert.equal(aclIsEnforced({ owner: '', allowed_roles: [], allowed_subjects: [] }), false);
  // data_class alone is metadata, not a grant/deny → does NOT flip enforcement on.
  assert.equal(aclIsEnforced({ data_class: 'confidential' }), false);
});

test('aclIsEnforced: any of owner / allowed_roles / allowed_subjects → enforced', () => {
  assert.equal(aclIsEnforced({ owner: 'a@x.io' }), true);
  assert.equal(aclIsEnforced({ allowed_roles: ['claims'] }), true);
  assert.equal(aclIsEnforced({ allowed_subjects: ['b@x.io'] }), true);
});

// ── docVisibleTo — the core rule ───────────────────────────────────────────────

test('docVisibleTo: un-ACL\'d doc is visible to everyone (backward compatible)', () => {
  assert.equal(docVisibleTo(null, undefined), true);
  assert.equal(docVisibleTo({ subject: 'anyone@x.io' }, {}), true);
  assert.equal(docVisibleTo(undefined, { data_class: 'public' }), true);
});

test('docVisibleTo: owner always sees their own doc (case-insensitive, trimmed)', () => {
  const acl: DocAcl = { owner: 'Alice@X.io', allowed_roles: ['claims'] };
  assert.equal(docVisibleTo({ subject: ' alice@x.io ' }, acl), true);
  assert.equal(docVisibleTo({ subject: 'bob@x.io' }, acl), false);
});

test('docVisibleTo: allowed_subjects membership grants', () => {
  const acl: DocAcl = { owner: 'alice@x.io', allowed_subjects: ['bob@x.io', 'carol@x.io'] };
  assert.equal(docVisibleTo({ subject: 'bob@x.io' }, acl), true);
  assert.equal(docVisibleTo({ subject: 'dave@x.io' }, acl), false);
});

test('docVisibleTo: allowed_roles membership grants (case-insensitive)', () => {
  const acl: DocAcl = { owner: 'alice@x.io', allowed_roles: ['Claims', 'legal'] };
  assert.equal(docVisibleTo({ subject: 'bob@x.io', roles: ['claims'] }, acl), true);
  assert.equal(docVisibleTo({ subject: 'bob@x.io', roles: ['sales'] }, acl), false);
  assert.equal(docVisibleTo({ subject: 'bob@x.io', roles: [] }, acl), false);
});

test('docVisibleTo: admin superuser sees enforced docs it has no explicit grant on', () => {
  const acl: DocAcl = { owner: 'alice@x.io', allowed_roles: ['claims'] };
  assert.equal(docVisibleTo({ subject: 'ops@x.io', roles: ['admin'] }, acl), true);
});

test('docVisibleTo: default-safe — enforced doc with no matching grant is HIDDEN', () => {
  const acl: DocAcl = { owner: 'alice@x.io', allowed_roles: ['claims'], allowed_subjects: ['carol@x.io'] };
  // anonymous, wrong role, wrong subject → not visible
  assert.equal(docVisibleTo(null, acl), false);
  assert.equal(docVisibleTo({ subject: 'mallory@x.io', roles: ['sales'] }, acl), false);
});

// ── askerFrom ───────────────────────────────────────────────────────────────

test('askerFrom: maps session email+role (+realm roles) into an Asker', () => {
  assert.deepEqual(askerFrom({ email: 'bob@x.io', role: 'claims' }), {
    subject: 'bob@x.io',
    roles: ['claims'],
  });
  const a = askerFrom({ email: 'bob@x.io', role: 'user', realmRoles: ['claims', 'legal', 'user'] });
  assert.equal(a.subject, 'bob@x.io');
  assert.deepEqual([...a.roles!].sort(), ['claims', 'legal', 'user']);
  // missing email → anonymous subject
  assert.equal(askerFrom({ role: 'claims' }).subject, undefined);
  assert.equal(askerFrom(null).subject, undefined);
});

// ── aclFromPayload ─────────────────────────────────────────────────────────────

test('aclFromPayload: reads ACL keys, tolerates missing/malformed', () => {
  assert.deepEqual(
    aclFromPayload({
      title: 't',
      owner: 'alice@x.io',
      allowed_roles: ['claims'],
      allowed_subjects: ['bob@x.io'],
      data_class: 'confidential',
    }),
    { owner: 'alice@x.io', allowed_roles: ['claims'], allowed_subjects: ['bob@x.io'], data_class: 'confidential' },
  );
  assert.deepEqual(aclFromPayload({ title: 't' }), {
    owner: null,
    allowed_roles: null,
    allowed_subjects: null,
    data_class: null,
  });
  assert.deepEqual(aclFromPayload({ allowed_roles: 'nope', owner: 42 }).allowed_roles, null);
});

// ── normalizeAcl ─────────────────────────────────────────────────────────────

test('normalizeAcl: empty / all-blank → null (un-ACL\'d, backward compatible)', () => {
  assert.equal(normalizeAcl(null), null);
  assert.equal(normalizeAcl('x'), null);
  assert.equal(normalizeAcl({}), null);
  assert.equal(normalizeAcl({ owner: '  ', allowed_roles: [], allowed_subjects: ['   '] }), null);
});

test('normalizeAcl: trims, drops blanks, keeps real grants', () => {
  assert.deepEqual(normalizeAcl({ owner: ' alice@x.io ', allowed_roles: ['claims', ''] }), {
    owner: 'alice@x.io',
    allowed_roles: ['claims'],
    allowed_subjects: null,
    data_class: null,
  });
});

// ── filterHitsByAcl (post-filter fallback) ──────────────────────────────────────

test('filterHitsByAcl: keeps visible hits, drops hidden, preserves order', () => {
  const asker = { subject: 'bob@x.io', roles: ['claims'] };
  const hits = [
    { id: 'a', acl: {} as DocAcl }, // un-ACL'd → visible
    { id: 'b', acl: { owner: 'alice@x.io', allowed_roles: ['sales'] } }, // hidden
    { id: 'c', acl: { owner: 'alice@x.io', allowed_roles: ['claims'] } }, // visible (role)
    { id: 'd', acl: { owner: 'bob@x.io' } }, // visible (owner)
  ];
  const out = filterHitsByAcl(asker, hits, (h) => h.acl);
  assert.deepEqual(out.map((h) => h.id), ['a', 'c', 'd']);
});

// ── buildQdrantAclShould (server-side narrowing DSL) ───────────────────────────

const FIELDS = { owner: 'owner', allowedRoles: 'allowed_roles', allowedSubjects: 'allowed_subjects', dataClass: 'data_class' };

test('buildQdrantAclShould: superuser → undefined (narrowing skipped)', () => {
  assert.equal(
    buildQdrantAclShould({ subject: 'ops@x.io', roles: ['admin'], superuserRoles: ['admin'], fields: FIELDS }),
    undefined,
  );
});

test('buildQdrantAclShould: emits owner/subject/role OR conditions', () => {
  const should = buildQdrantAclShould({ subject: 'bob@x.io', roles: ['claims', 'legal'], superuserRoles: ['admin'], fields: FIELDS });
  assert.deepEqual(should, [
    { key: 'owner', match: { value: 'bob@x.io' } },
    { key: 'allowed_subjects', match: { any: ['bob@x.io'] } },
    { key: 'allowed_roles', match: { any: ['claims', 'legal'] } },
  ]);
});

test('buildQdrantAclShould: no identifying grants → undefined', () => {
  assert.equal(buildQdrantAclShould({ subject: '', roles: [], superuserRoles: ['admin'], fields: FIELDS }), undefined);
});
