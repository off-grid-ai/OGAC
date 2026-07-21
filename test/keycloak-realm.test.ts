import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  KNOWN_REQUIRED_ACTIONS,
  REALM_MANAGEMENT_CLIENT,
  buildOidcIdpRep,
  deriveMfaStatus,
  extractLifetimes,
  federationGrantCommand,
  federationGrantRoleNames,
  forbiddenGrantMessage,
  isKnownRequiredAction,
  serviceAccountUsername,
  formatDuration,
  mergeRealmLifetimes,
  mergeUserSessions,
  normalizeIdps,
  normalizeRequiredActions,
  normalizeSession,
  normalizeSessions,
  validateLifetimesPatch,
  withConfigureOtp,
  withRequiredAction,
  withoutConfigureOtp,
  withoutRequiredAction,
} from '../src/lib/keycloak-realm.ts';

// ── Sessions ─────────────────────────────────────────────────────────────────

test('normalizeSessions: shapes raw sessions, sorts most-recent first, flattens clients', () => {
  const out = normalizeSessions([
    {
      id: 's1',
      username: 'alice',
      ipAddress: '10.0.0.1',
      start: 1000,
      lastAccess: 2000,
      clients: { abc: 'account', def: 'console' },
    },
    { id: 's2', username: 'alice', start: 1000, lastAccess: 5000 },
  ]);
  assert.equal(out[0].id, 's2'); // higher lastAccess sorts first
  assert.equal(out[1].id, 's1');
  assert.deepEqual(out[1].clients, ['account', 'console']);
  // Missing fields tolerated.
  assert.equal(out[0].ipAddress, '');
  assert.deepEqual(out[0].clients, []);
  // online sessions are tagged offline:false by default.
  assert.equal(out[0].offline, false);
  assert.equal(out[1].offline, false);
});

test('normalizeSession: mDNS-maps the session IP — never leaks a raw loopback/LAN address', () => {
  // Loopback → S1 (the console reaches Keycloak over loopback, so a same-host login logs 127.0.0.1).
  assert.equal(normalizeSession({ id: 's', ipAddress: '127.0.0.1' }).ipAddress, 'offgrid-s1.local');
  // Known fleet IP → its mDNS host.
  assert.equal(normalizeSession({ id: 's', ipAddress: '192.168.1.66' }).ipAddress, 'offgrid-g6.local');
  // Unknown private IP → S1 (defensive: still no raw IP leaks).
  assert.equal(normalizeSession({ id: 's', ipAddress: '10.0.0.5' }).ipAddress, 'offgrid-s1.local');
  // A public/real address is left untouched.
  assert.equal(normalizeSession({ id: 's', ipAddress: '203.0.113.9' }).ipAddress, '203.0.113.9');
  // Empty stays empty (no spurious mapping).
  assert.equal(normalizeSession({ id: 's' }).ipAddress, '');
});

test('mergeUserSessions: unions online + offline, dedupes by id (online wins), sorts recent-first', () => {
  const online = [
    { id: 'a', username: 'mac', ipAddress: '127.0.0.1', start: 1000, lastAccess: 3000 },
  ];
  const offline = [
    // same id as an online session — must NOT duplicate; the online (live) one wins.
    { id: 'a', username: 'mac', ipAddress: '127.0.0.1', start: 1000, lastAccess: 1500 },
    // an offline-only session — this is what surfaces a logged-in operator whose online session expired.
    { id: 'b', username: 'mac', ipAddress: '192.168.1.66', start: 500, lastAccess: 4000 },
  ];
  const out = mergeUserSessions(online, offline);
  assert.equal(out.length, 2); // deduped
  assert.equal(out[0].id, 'b'); // higher lastAccess first
  assert.equal(out[0].offline, true);
  assert.equal(out[0].ipAddress, 'offgrid-g6.local'); // mDNS'd
  assert.equal(out[1].id, 'a');
  assert.equal(out[1].offline, false); // online wins for the shared id
  assert.equal(out[1].lastAccess, 3000);
});

// ── Forbidden-grant messaging (actionable 403) ────────────────────────────────

test('forbiddenGrantMessage: names the exact realm-management role on a 403', () => {
  const msg = forbiddenGrantMessage('list-identity-providers', 403, 'HTTP 403');
  assert.match(msg, /view-identity-providers/);
  assert.match(msg, /realm-management/);
  assert.match(msg, /OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID/);

  assert.match(forbiddenGrantMessage('manage-identity-providers', 403, 'x'), /manage-identity-providers/);
  assert.match(forbiddenGrantMessage('manage-users', 403, 'x'), /manage-users/);
});

test('forbiddenGrantMessage: passes the original message through for non-403 statuses', () => {
  assert.equal(forbiddenGrantMessage('list-identity-providers', 500, 'boom'), 'boom');
  assert.equal(forbiddenGrantMessage('view-users', 404, 'not found'), 'not found');
});

// ── Federation self-heal (GAP #40) ────────────────────────────────────────────

test('federationGrantRoleNames: exactly the two IdP realm-management roles, fresh array each call', () => {
  assert.deepEqual(federationGrantRoleNames(), ['view-identity-providers', 'manage-identity-providers']);
  const a = federationGrantRoleNames();
  a.push('mutated');
  // Source of truth is not mutated by a caller pushing into the returned array.
  assert.deepEqual(federationGrantRoleNames(), ['view-identity-providers', 'manage-identity-providers']);
});

test('serviceAccountUsername: Keycloak service-account naming, lower-cased and trimmed', () => {
  assert.equal(serviceAccountUsername('console-admin'), 'service-account-console-admin');
  assert.equal(serviceAccountUsername('  Console-Admin  '), 'service-account-console-admin');
});

test('federationGrantCommand: copy-pasteable kcadm add-roles for both roles on realm-management', () => {
  const cmd = federationGrantCommand('console-admin');
  assert.match(cmd, /add-roles/);
  assert.match(cmd, /service-account-console-admin/);
  assert.match(cmd, new RegExp(REALM_MANAGEMENT_CLIENT));
  assert.match(cmd, /view-identity-providers/);
  assert.match(cmd, /manage-identity-providers/);
});

// ── MFA / required actions ──────────────────────────────────────────────────

test('deriveMfaStatus: otpConfigured true iff an otp credential exists', () => {
  const with_otp = deriveMfaStatus([
    { id: 'c1', type: 'password' },
    { id: 'c2', type: 'otp', userLabel: 'Authenticator' },
  ]);
  assert.equal(with_otp.otpConfigured, true);
  assert.equal(with_otp.credentials.length, 2);
  assert.equal(with_otp.credentials[1].label, 'Authenticator');

  const no_otp = deriveMfaStatus([{ id: 'c1', type: 'password' }]);
  assert.equal(no_otp.otpConfigured, false);
});

test('deriveMfaStatus: falls back to type when userLabel is missing', () => {
  const out = deriveMfaStatus([{ id: 'c1', type: 'otp' }]);
  assert.equal(out.credentials[0].label, 'otp');
});

test('withConfigureOtp: adds CONFIGURE_TOTP idempotently, preserves others', () => {
  assert.deepEqual(withConfigureOtp(undefined), ['CONFIGURE_TOTP']);
  assert.deepEqual(withConfigureOtp(['VERIFY_EMAIL']), ['VERIFY_EMAIL', 'CONFIGURE_TOTP']);
  // No duplicate on re-apply.
  assert.deepEqual(withConfigureOtp(['CONFIGURE_TOTP']), ['CONFIGURE_TOTP']);
});

test('withoutConfigureOtp: removes only CONFIGURE_TOTP', () => {
  assert.deepEqual(withoutConfigureOtp(['VERIFY_EMAIL', 'CONFIGURE_TOTP']), ['VERIFY_EMAIL']);
  assert.deepEqual(withoutConfigureOtp(undefined), []);
});

test('normalizeRequiredActions: defaults enabled/defaultAction and name', () => {
  const out = normalizeRequiredActions([
    { alias: 'CONFIGURE_TOTP', name: 'Configure OTP', enabled: true, defaultAction: false },
    { alias: 'VERIFY_EMAIL' },
  ]);
  assert.equal(out[0].name, 'Configure OTP');
  assert.equal(out[1].name, 'VERIFY_EMAIL'); // falls back to alias
  assert.equal(out[1].enabled, false);
});

// ── IdP federation ──────────────────────────────────────────────────────────

test('normalizeIdps: sorts by alias and surfaces select config keys', () => {
  const out = normalizeIdps([
    { alias: 'zeta', providerId: 'saml' },
    {
      alias: 'alpha',
      displayName: 'Alpha SSO',
      providerId: 'oidc',
      enabled: true,
      config: { authorizationUrl: 'https://a/auth', tokenUrl: 'https://a/tok', clientId: 'cid' },
    },
  ]);
  assert.equal(out[0].alias, 'alpha');
  assert.equal(out[0].displayName, 'Alpha SSO');
  assert.equal(out[0].clientId, 'cid');
  assert.equal(out[1].displayName, 'zeta'); // falls back to alias
});

test('buildOidcIdpRep: valid input produces an OIDC rep', () => {
  const res = buildOidcIdpRep({
    alias: 'okta',
    authorizationUrl: 'https://okta/auth',
    tokenUrl: 'https://okta/token',
    clientId: 'cid',
    clientSecret: 'secret',
  });
  assert.ok('rep' in res);
  if ('rep' in res) {
    assert.equal(res.rep.providerId, 'oidc');
    assert.equal(res.rep.enabled, true);
    assert.equal(res.rep.displayName, 'okta'); // defaults to alias
    assert.equal(res.rep.config?.clientId, 'cid');
    assert.equal(res.rep.config?.clientAuthMethod, 'client_secret_post');
  }
});

test('buildOidcIdpRep: rejects missing/invalid fields', () => {
  assert.deepEqual(buildOidcIdpRep({ alias: '', authorizationUrl: 'a', tokenUrl: 't', clientId: 'c', clientSecret: 's' }), {
    error: 'alias is required',
  });
  assert.deepEqual(
    buildOidcIdpRep({ alias: 'bad alias', authorizationUrl: 'a', tokenUrl: 't', clientId: 'c', clientSecret: 's' }),
    { error: 'alias may only contain letters, numbers, hyphen and underscore' },
  );
  assert.deepEqual(
    buildOidcIdpRep({ alias: 'ok', authorizationUrl: '', tokenUrl: 't', clientId: 'c', clientSecret: 's' }),
    { error: 'authorizationUrl is required' },
  );
});

// ── Token / session lifetimes ────────────────────────────────────────────────

test('extractLifetimes: pulls only numeric lifetime fields from a full realm rep', () => {
  const out = extractLifetimes({
    realm: 'offgrid',
    displayName: 'Off Grid',
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 36000,
    registrationAllowed: false, // ignored — not a lifetime key
    accessTokenLifespanForImplicitFlow: undefined, // ignored — not a number
  });
  assert.equal(out.realm, 'offgrid');
  assert.equal(out.accessTokenLifespan, 300);
  assert.equal(out.ssoSessionMaxLifespan, 36000);
  assert.equal(out.accessTokenLifespanForImplicitFlow, undefined);
});

test('validateLifetimesPatch: keeps known non-negative integers, rejects bad values', () => {
  const ok = validateLifetimesPatch({ accessTokenLifespan: 600, bogus: 1, ssoSessionIdleTimeout: 900 });
  assert.ok('patch' in ok);
  if ('patch' in ok) {
    assert.deepEqual(ok.patch, { accessTokenLifespan: 600, ssoSessionIdleTimeout: 900 });
  }

  assert.deepEqual(validateLifetimesPatch({ accessTokenLifespan: -5 }), {
    error: 'accessTokenLifespan must be a non-negative integer (seconds)',
  });
  assert.deepEqual(validateLifetimesPatch({ accessTokenLifespan: 1.5 }), {
    error: 'accessTokenLifespan must be a non-negative integer (seconds)',
  });
  assert.deepEqual(validateLifetimesPatch({ nothing: 1 }), {
    error: 'no valid lifetime fields to update',
  });
});

test('mergeRealmLifetimes: overwrites only the patched keys, preserves the rest (no clobber)', () => {
  const current = {
    realm: 'offgrid',
    displayName: 'Off Grid',
    registrationAllowed: true,
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
  };
  const merged = mergeRealmLifetimes(current, { accessTokenLifespan: 600 });
  // Patched.
  assert.equal(merged.accessTokenLifespan, 600);
  // Everything else survives — this is the anti-clobber guarantee.
  assert.equal(merged.displayName, 'Off Grid');
  assert.equal(merged.registrationAllowed, true);
  assert.equal(merged.ssoSessionIdleTimeout, 1800);
  // Original object is not mutated.
  assert.equal(current.accessTokenLifespan, 300);
});

test('formatDuration: human-readable seconds', () => {
  assert.equal(formatDuration(undefined), '—');
  assert.equal(formatDuration(-1), '—');
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(90), '1m 30s');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(5430), '1h 30m 30s');
});

// ── Required actions (generalized) ─────────────────────────────────────────────

test('withRequiredAction: adds the action, idempotent, preserves the rest', () => {
  assert.deepEqual(withRequiredAction([], 'VERIFY_EMAIL'), ['VERIFY_EMAIL']);
  assert.deepEqual(withRequiredAction(undefined, 'VERIFY_EMAIL'), ['VERIFY_EMAIL']);
  assert.deepEqual(
    withRequiredAction(['UPDATE_PASSWORD'], 'VERIFY_EMAIL').sort(),
    ['UPDATE_PASSWORD', 'VERIFY_EMAIL'],
  );
  // idempotent — no duplicate
  assert.deepEqual(withRequiredAction(['VERIFY_EMAIL'], 'VERIFY_EMAIL'), ['VERIFY_EMAIL']);
});

test('withoutRequiredAction: removes only the target, preserves the rest', () => {
  assert.deepEqual(
    withoutRequiredAction(['VERIFY_EMAIL', 'UPDATE_PASSWORD'], 'VERIFY_EMAIL'),
    ['UPDATE_PASSWORD'],
  );
  assert.deepEqual(withoutRequiredAction(undefined, 'VERIFY_EMAIL'), []);
  assert.deepEqual(withoutRequiredAction(['UPDATE_PASSWORD'], 'VERIFY_EMAIL'), ['UPDATE_PASSWORD']);
});

test('withConfigureOtp/withoutConfigureOtp: delegate to the generic helper (CONFIGURE_TOTP)', () => {
  assert.deepEqual(withConfigureOtp(['VERIFY_EMAIL']).sort(), ['CONFIGURE_TOTP', 'VERIFY_EMAIL']);
  assert.deepEqual(withoutConfigureOtp(['CONFIGURE_TOTP', 'VERIFY_EMAIL']), ['VERIFY_EMAIL']);
});

test('isKnownRequiredAction: only curated aliases are writable', () => {
  assert.equal(isKnownRequiredAction('VERIFY_EMAIL'), true);
  assert.equal(isKnownRequiredAction('CONFIGURE_TOTP'), true);
  assert.equal(isKnownRequiredAction('DELETE_ACCOUNT'), false);
  assert.equal(isKnownRequiredAction(''), false);
});

test('KNOWN_REQUIRED_ACTIONS: every entry has alias + label + help', () => {
  assert.ok(KNOWN_REQUIRED_ACTIONS.length >= 3);
  for (const a of KNOWN_REQUIRED_ACTIONS) {
    assert.ok(a.alias && a.label && a.help, `spec ${a.alias} is complete`);
  }
});
