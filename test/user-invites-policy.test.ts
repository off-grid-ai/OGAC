import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_INVITE_TTL_DAYS,
  INVITE_ORG_ROLES,
  INVITE_REQUIRED_ACTIONS,
  baseUrlFromHeaders,
  buildAcceptUrl,
  buildInviteEmail,
  canRevoke,
  evaluateAccept,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFrom,
  isValidEmail,
  keycloakRealmRoleForOrgRole,
  normalizeEmail,
  normalizeOrgRole,
  sanitizeAppGrants,
  validateInviteCreate,
} from '../src/lib/user-invites-policy.ts';

// ─── email normalisation + validation ───────────────────────────────────────────────────────────────
test('normalizeEmail trims + lower-cases; non-strings → empty', () => {
  assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
  assert.equal(normalizeEmail(42), '');
  assert.equal(normalizeEmail(null), '');
});

test('isValidEmail accepts real addresses, rejects junk + overlong', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('person@company.co.in'), true);
  assert.equal(isValidEmail('no-at-sign'), false);
  assert.equal(isValidEmail('a@b'), false); // no dotted domain
  assert.equal(isValidEmail('a b@c.com'), false); // space
  assert.equal(isValidEmail(`${'x'.repeat(320)}@c.com`), false); // overlong
});

// ─── org role ────────────────────────────────────────────────────────────────────────────────────
test('normalizeOrgRole defaults to viewer; keeps valid roles', () => {
  assert.equal(normalizeOrgRole('admin'), 'admin');
  assert.equal(normalizeOrgRole('compliance'), 'compliance');
  assert.equal(normalizeOrgRole('nonsense'), 'viewer');
  assert.equal(normalizeOrgRole(undefined), 'viewer');
  assert.deepEqual([...INVITE_ORG_ROLES], ['admin', 'compliance', 'viewer']);
});

test('keycloakRealmRoleForOrgRole maps 1:1 today', () => {
  assert.equal(keycloakRealmRoleForOrgRole('admin'), 'admin');
  assert.equal(keycloakRealmRoleForOrgRole('viewer'), 'viewer');
});

// ─── app grants sanitisation ────────────────────────────────────────────────────────────────────────
test('sanitizeAppGrants drops empties, dedupes by appId, defaults role', () => {
  assert.deepEqual(sanitizeAppGrants('nope'), []);
  assert.deepEqual(
    sanitizeAppGrants([
      { appId: 'app1', appRole: 'runner' },
      { appId: '  ', appRole: 'editor' }, // empty id dropped
      { appId: 'app1', appRole: 'editor' }, // dup id dropped (first wins)
      { appId: 'app2' }, // missing role → viewer
      { appId: 'app3', appRole: 'bogus' }, // bad role → viewer
    ]),
    [
      { appId: 'app1', appRole: 'runner' },
      { appId: 'app2', appRole: 'viewer' },
      { appId: 'app3', appRole: 'viewer' },
    ],
  );
});

// ─── create-payload validation ──────────────────────────────────────────────────────────────────────
test('validateInviteCreate: valid minimal payload', () => {
  const v = validateInviteCreate({ email: '  Person@Corp.com ' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value, { email: 'person@corp.com', role: 'viewer', appGrants: [] });
});

test('validateInviteCreate: full payload with role + grants', () => {
  const v = validateInviteCreate({
    email: 'p@c.com',
    role: 'admin',
    appGrants: [{ appId: 'a1', appRole: 'editor' }],
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value?.role, 'admin');
  assert.deepEqual(v.value?.appGrants, [{ appId: 'a1', appRole: 'editor' }]);
});

test('validateInviteCreate: bad email is rejected', () => {
  const v = validateInviteCreate({ email: 'nope' });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /valid email/);
  assert.equal(v.value, undefined);
});

test('validateInviteCreate: invalid role is a hard error (no silent downgrade)', () => {
  const v = validateInviteCreate({ email: 'p@c.com', role: 'superuser' });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /role must be one of/);
});

test('validateInviteCreate: absent role defaults, empty-string role defaults', () => {
  assert.equal(validateInviteCreate({ email: 'p@c.com', role: '' }).value?.role, 'viewer');
  assert.equal(validateInviteCreate({ email: 'p@c.com', role: null }).value?.role, 'viewer');
});

test('validateInviteCreate: non-array appGrants + bad grant role + missing appId are errors', () => {
  const v1 = validateInviteCreate({ email: 'p@c.com', appGrants: 'x' });
  assert.equal(v1.ok, false);
  assert.match(v1.errors.join(), /appGrants must be a list/);

  const v2 = validateInviteCreate({ email: 'p@c.com', appGrants: [{ appId: 'a', appRole: 'boss' }] });
  assert.equal(v2.ok, false);
  assert.match(v2.errors.join(), /app grant role must be one of/);

  const v3 = validateInviteCreate({ email: 'p@c.com', appGrants: [{ appRole: 'runner' }] });
  assert.equal(v3.ok, false);
  assert.match(v3.errors.join(), /each app grant needs an appId/);
});

test('validateInviteCreate: a grant with appId + no role is valid (defaults viewer)', () => {
  const v = validateInviteCreate({ email: 'p@c.com', appGrants: [{ appId: 'a1' }] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value?.appGrants, [{ appId: 'a1', appRole: 'viewer' }]);
});

// ─── token: opaque, hashed, deterministic hash ────────────────────────────────────────────────────
test('generateInviteToken yields a fresh token + matching sha256 hash', () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  assert.notEqual(a.token, b.token, 'tokens are unique');
  assert.equal(a.tokenHash, hashInviteToken(a.token), 'hash matches the plaintext');
  assert.equal(a.tokenHash.length, 64, 'sha256 hex is 64 chars');
  assert.notEqual(a.token, a.tokenHash, 'the stored form is not the plaintext');
});

test('hashInviteToken is deterministic + tolerates non-strings', () => {
  assert.equal(hashInviteToken('abc'), hashInviteToken('abc'));
  assert.equal(hashInviteToken(undefined as unknown as string).length, 64);
});

// ─── expiry ─────────────────────────────────────────────────────────────────────────────────────────
test('inviteExpiryFrom adds the TTL; guards bad TTLs to the default', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const def = inviteExpiryFrom(now);
  assert.equal(def.getTime() - now.getTime(), DEFAULT_INVITE_TTL_DAYS * 86400_000);
  assert.equal(inviteExpiryFrom(now, 1).getTime() - now.getTime(), 86400_000);
  // non-positive / non-finite fall back to default
  assert.equal(inviteExpiryFrom(now, 0).getTime(), def.getTime());
  assert.equal(inviteExpiryFrom(now, -5).getTime(), def.getTime());
  assert.equal(inviteExpiryFrom(now, NaN).getTime(), def.getTime());
});

// ─── accept state machine ───────────────────────────────────────────────────────────────────────────
const NOW = new Date('2026-01-10T00:00:00Z');
const FUTURE = new Date('2026-01-20T00:00:00Z');
const PAST = new Date('2026-01-05T00:00:00Z');

test('evaluateAccept: pending + unexpired → ok', () => {
  const d = evaluateAccept({ status: 'pending', expiresAt: FUTURE }, NOW);
  assert.deepEqual(d, { ok: true, effectiveStatus: 'pending', reason: '' });
});

test('evaluateAccept: pending + past expiry → expired (effective status flips)', () => {
  const d = evaluateAccept({ status: 'pending', expiresAt: PAST }, NOW);
  assert.equal(d.ok, false);
  assert.equal(d.effectiveStatus, 'expired');
  assert.match(d.reason, /expired/);
});

test('evaluateAccept: revoked → rejected', () => {
  const d = evaluateAccept({ status: 'revoked', expiresAt: FUTURE }, NOW);
  assert.equal(d.ok, false);
  assert.equal(d.effectiveStatus, 'revoked');
});

test('evaluateAccept: already accepted → rejected (single-use)', () => {
  const d = evaluateAccept({ status: 'accepted', expiresAt: FUTURE }, NOW);
  assert.equal(d.ok, false);
  assert.equal(d.effectiveStatus, 'accepted');
  assert.match(d.reason, /already/);
});

test('evaluateAccept: explicitly-expired status → rejected even if the clock says future', () => {
  const d = evaluateAccept({ status: 'expired', expiresAt: FUTURE }, NOW);
  assert.equal(d.ok, false);
  assert.equal(d.effectiveStatus, 'expired');
});

test('evaluateAccept: exactly at expiry instant → expired (>= boundary)', () => {
  const d = evaluateAccept({ status: 'pending', expiresAt: NOW }, NOW);
  assert.equal(d.ok, false);
  assert.equal(d.effectiveStatus, 'expired');
});

test('canRevoke mirrors evaluateAccept.ok', () => {
  assert.equal(canRevoke({ status: 'pending', expiresAt: FUTURE }, NOW), true);
  assert.equal(canRevoke({ status: 'pending', expiresAt: PAST }, NOW), false);
  assert.equal(canRevoke({ status: 'accepted', expiresAt: FUTURE }, NOW), false);
});

// ─── accept URL + base URL ────────────────────────────────────────────────────────────────────────
test('buildAcceptUrl strips trailing slash + encodes the token', () => {
  assert.equal(
    buildAcceptUrl('https://acme.example.com/', 'a b/c'),
    'https://acme.example.com/invite/accept?token=a%20b%2Fc',
  );
  assert.equal(buildAcceptUrl('', 'tok'), '/invite/accept?token=tok');
});

test('baseUrlFromHeaders honors forwarded headers, host fallback, env, and localhost', () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  assert.equal(
    baseUrlFromHeaders(h({ 'x-forwarded-host': 'acme.example.com', 'x-forwarded-proto': 'https' })),
    'https://acme.example.com',
  );
  // bare host, no proto → https default for non-localhost
  assert.equal(baseUrlFromHeaders(h({ host: 'acme.example.com' })), 'https://acme.example.com');
  // localhost → http
  assert.equal(baseUrlFromHeaders(h({ host: 'localhost:3000' })), 'http://localhost:3000');
  // no host → env origin (trailing slash stripped)
  assert.equal(baseUrlFromHeaders(h({}), 'https://env.example.com/'), 'https://env.example.com');
  // no host, no env → localhost default
  assert.equal(baseUrlFromHeaders(h({})), 'http://localhost:3000');
});

// ─── email body (brand voice) ───────────────────────────────────────────────────────────────────────
test('buildInviteEmail: subject + body carry the brand + accept link + expiry', () => {
  const e = buildInviteEmail({
    orgName: 'Acme Bank',
    acceptUrl: 'https://acme/invite/accept?token=x',
    invitedByName: 'Mac',
    expiresAtDisplay: 'Fri, 10 Jul 2026',
  });
  assert.equal(e.subject, "You've been invited to Acme Bank on Off Grid AI");
  assert.match(e.text, /Mac has invited you/);
  assert.match(e.text, /Off Grid AI/);
  assert.match(e.text, /https:\/\/acme\/invite\/accept\?token=x/);
  assert.match(e.text, /Fri, 10 Jul 2026/);
});

test('buildInviteEmail: no inviter name + empty org falls back gracefully', () => {
  const e = buildInviteEmail({ orgName: '', acceptUrl: 'u', expiresAtDisplay: 'soon' });
  assert.match(e.subject, /your team/);
  assert.match(e.text, /You've been invited to join your team/);
});

// ─── required actions constant ────────────────────────────────────────────────────────────────────
test('INVITE_REQUIRED_ACTIONS forces set-password + verify-email (Keycloak owns the credential)', () => {
  assert.deepEqual([...INVITE_REQUIRED_ACTIONS], ['UPDATE_PASSWORD', 'VERIFY_EMAIL']);
});
