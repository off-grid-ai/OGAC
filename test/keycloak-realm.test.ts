import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildOidcIdpRep,
  deriveMfaStatus,
  extractLifetimes,
  formatDuration,
  mergeRealmLifetimes,
  normalizeIdps,
  normalizeRequiredActions,
  normalizeSessions,
  validateLifetimesPatch,
  withConfigureOtp,
  withoutConfigureOtp,
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
