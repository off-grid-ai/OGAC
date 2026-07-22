import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_OTP_POLICY,
  OTP_POLICY_ALGORITHMS,
  OTP_POLICY_DIGITS,
  OTP_POLICY_TYPES,
  describeOtpPolicy,
  extractOtpPolicy,
  mergeOtpPolicy,
  providerTypeLabel,
  summarizeFederation,
  validateOtpPolicyPatch,
  type FederationIdp,
} from '../src/lib/keycloak-federation.ts';

// ── extractOtpPolicy ──────────────────────────────────────────────────────────────

test('extractOtpPolicy reads a fully-populated realm rep', () => {
  const p = extractOtpPolicy({
    otpPolicyType: 'hotp',
    otpPolicyAlgorithm: 'HmacSHA512',
    otpPolicyDigits: 8,
    otpPolicyPeriod: 60,
    otpPolicyInitialCounter: 5,
    otpPolicyLookAheadWindow: 3,
    otpPolicyCodeReusable: true,
  });
  assert.deepEqual(p, {
    type: 'hotp',
    algorithm: 'HmacSHA512',
    digits: 8,
    period: 60,
    initialCounter: 5,
    lookAheadWindow: 3,
    codeReusable: true,
  });
});

test('extractOtpPolicy falls back to Keycloak defaults on a minimally-seeded realm', () => {
  assert.deepEqual(extractOtpPolicy({}), DEFAULT_OTP_POLICY);
});

test('extractOtpPolicy coerces unknown enum values to safe defaults', () => {
  const p = extractOtpPolicy({
    otpPolicyType: 'bogus',
    otpPolicyAlgorithm: 'HmacMD5',
    otpPolicyDigits: 7,
  });
  assert.equal(p.type, 'totp');
  assert.equal(p.algorithm, 'HmacSHA1');
  assert.equal(p.digits, 6);
});

test('extractOtpPolicy accepts the SHA256 algorithm and 8 digits explicitly', () => {
  const p = extractOtpPolicy({ otpPolicyAlgorithm: 'HmacSHA256', otpPolicyDigits: 8 });
  assert.equal(p.algorithm, 'HmacSHA256');
  assert.equal(p.digits, 8);
});

test('extractOtpPolicy ignores non-numeric / non-boolean field types', () => {
  const p = extractOtpPolicy({
    otpPolicyPeriod: '30',
    otpPolicyInitialCounter: null,
    otpPolicyLookAheadWindow: undefined,
    otpPolicyCodeReusable: 'yes',
  });
  assert.equal(p.period, DEFAULT_OTP_POLICY.period);
  assert.equal(p.initialCounter, DEFAULT_OTP_POLICY.initialCounter);
  assert.equal(p.lookAheadWindow, DEFAULT_OTP_POLICY.lookAheadWindow);
  assert.equal(p.codeReusable, DEFAULT_OTP_POLICY.codeReusable);
});

// ── validateOtpPolicyPatch ──────────────────────────────────────────────────────────

test('validateOtpPolicyPatch accepts a full valid patch', () => {
  const r = validateOtpPolicyPatch({
    type: 'totp',
    algorithm: 'HmacSHA256',
    digits: 8,
    period: 30,
    initialCounter: 0,
    lookAheadWindow: 2,
    codeReusable: false,
  });
  assert.ok('patch' in r);
  assert.deepEqual(r.patch, {
    type: 'totp',
    algorithm: 'HmacSHA256',
    digits: 8,
    period: 30,
    initialCounter: 0,
    lookAheadWindow: 2,
    codeReusable: false,
  });
});

test('validateOtpPolicyPatch rejects an unknown type', () => {
  const r = validateOtpPolicyPatch({ type: 'sms' });
  assert.ok('error' in r);
  assert.match(r.error, /type must be one of/);
});

test('validateOtpPolicyPatch rejects an unknown algorithm', () => {
  const r = validateOtpPolicyPatch({ algorithm: 'HmacMD5' });
  assert.ok('error' in r && /algorithm must be one of/.test(r.error));
});

test('validateOtpPolicyPatch rejects an unknown digit count', () => {
  const r = validateOtpPolicyPatch({ digits: 7 });
  assert.ok('error' in r && /digits must be one of/.test(r.error));
});

test('validateOtpPolicyPatch rejects a non-positive period', () => {
  assert.ok('error' in validateOtpPolicyPatch({ period: 0 }));
  assert.ok('error' in validateOtpPolicyPatch({ period: 1.5 }));
});

test('validateOtpPolicyPatch rejects a negative initialCounter but accepts zero', () => {
  assert.ok('error' in validateOtpPolicyPatch({ initialCounter: -1 }));
  const ok = validateOtpPolicyPatch({ initialCounter: 0 });
  assert.ok('patch' in ok && ok.patch.initialCounter === 0);
});

test('validateOtpPolicyPatch rejects a non-integer initialCounter', () => {
  assert.ok('error' in validateOtpPolicyPatch({ initialCounter: 2.2 }));
});

test('validateOtpPolicyPatch rejects a non-positive lookAheadWindow', () => {
  assert.ok('error' in validateOtpPolicyPatch({ lookAheadWindow: 0 }));
});

test('validateOtpPolicyPatch rejects a non-boolean codeReusable', () => {
  const r = validateOtpPolicyPatch({ codeReusable: 'true' });
  assert.ok('error' in r && /codeReusable must be a boolean/.test(r.error));
});

test('validateOtpPolicyPatch accepts a boolean codeReusable', () => {
  const r = validateOtpPolicyPatch({ codeReusable: true });
  assert.ok('patch' in r && r.patch.codeReusable === true);
});

test('validateOtpPolicyPatch errors on an empty / unknown-only patch', () => {
  const r = validateOtpPolicyPatch({ unknown: 1 });
  assert.ok('error' in r && /no valid OTP policy fields/.test(r.error));
});

test('validateOtpPolicyPatch ignores explicitly-undefined fields', () => {
  const r = validateOtpPolicyPatch({ type: undefined, digits: 8 });
  assert.ok('patch' in r);
  assert.deepEqual(r.patch, { digits: 8 });
});

// ── mergeOtpPolicy ──────────────────────────────────────────────────────────────────

test('mergeOtpPolicy overwrites only the patched OTP fields, preserving the rest of the realm rep', () => {
  const current = {
    realm: 'offgrid',
    displayName: 'Off Grid',
    otpPolicyType: 'totp',
    otpPolicyDigits: 6,
    sslRequired: 'external',
  };
  const merged = mergeOtpPolicy(current, { type: 'hotp', digits: 8, initialCounter: 3 });
  // untouched realm fields survive (the anti-clobber invariant)
  assert.equal(merged.realm, 'offgrid');
  assert.equal(merged.displayName, 'Off Grid');
  assert.equal(merged.sslRequired, 'external');
  // patched OTP fields applied under the Keycloak rep names
  assert.equal(merged.otpPolicyType, 'hotp');
  assert.equal(merged.otpPolicyDigits, 8);
  assert.equal(merged.otpPolicyInitialCounter, 3);
});

test('mergeOtpPolicy maps every field to its realm-rep key', () => {
  const merged = mergeOtpPolicy(
    {},
    {
      type: 'totp',
      algorithm: 'HmacSHA512',
      digits: 8,
      period: 45,
      initialCounter: 0,
      lookAheadWindow: 4,
      codeReusable: true,
    },
  );
  assert.equal(merged.otpPolicyType, 'totp');
  assert.equal(merged.otpPolicyAlgorithm, 'HmacSHA512');
  assert.equal(merged.otpPolicyDigits, 8);
  assert.equal(merged.otpPolicyPeriod, 45);
  assert.equal(merged.otpPolicyInitialCounter, 0);
  assert.equal(merged.otpPolicyLookAheadWindow, 4);
  assert.equal(merged.otpPolicyCodeReusable, true);
});

test('mergeOtpPolicy with an empty patch returns the current rep unchanged', () => {
  const current = { realm: 'offgrid', otpPolicyType: 'totp' };
  assert.deepEqual(mergeOtpPolicy(current, {}), current);
});

// ── describeOtpPolicy ────────────────────────────────────────────────────────────────

test('describeOtpPolicy renders a TOTP single-use summary', () => {
  const s = describeOtpPolicy({ ...DEFAULT_OTP_POLICY });
  assert.match(s, /6-digit HmacSHA1 time-based, 30s window, single-use codes/);
});

test('describeOtpPolicy renders a HOTP reusable summary', () => {
  const s = describeOtpPolicy({
    type: 'hotp',
    algorithm: 'HmacSHA256',
    digits: 8,
    period: 30,
    initialCounter: 0,
    lookAheadWindow: 1,
    codeReusable: true,
  });
  assert.match(s, /8-digit HmacSHA256 counter-based \(HOTP\), codes reusable/);
});

// ── providerTypeLabel ────────────────────────────────────────────────────────────────

test('providerTypeLabel maps known provider ids', () => {
  assert.equal(providerTypeLabel('oidc'), 'OpenID Connect');
  assert.equal(providerTypeLabel('saml'), 'SAML 2.0');
  assert.equal(providerTypeLabel('google'), 'Google');
});

test('providerTypeLabel upper-cases an unknown provider id', () => {
  assert.equal(providerTypeLabel('okta'), 'OKTA');
});

// ── summarizeFederation ───────────────────────────────────────────────────────────────

test('summarizeFederation counts state and groups by provider type (desc by count)', () => {
  const idps: FederationIdp[] = [
    { alias: 'okta-oidc', providerId: 'oidc', enabled: true },
    { alias: 'azure-saml', providerId: 'saml', enabled: false },
    { alias: 'ping-oidc', providerId: 'oidc', enabled: true },
  ];
  const s = summarizeFederation(idps);
  assert.equal(s.total, 3);
  assert.equal(s.enabled, 2);
  assert.equal(s.disabled, 1);
  assert.deepEqual(s.byType, [
    { providerId: 'oidc', label: 'OpenID Connect', count: 2 },
    { providerId: 'saml', label: 'SAML 2.0', count: 1 },
  ]);
});

test('summarizeFederation handles an empty federation', () => {
  const s = summarizeFederation([]);
  assert.deepEqual(s, { total: 0, enabled: 0, disabled: 0, byType: [] });
});

test('summarizeFederation breaks equal counts by label', () => {
  const idps: FederationIdp[] = [
    { alias: 'z', providerId: 'saml', enabled: true },
    { alias: 'a', providerId: 'oidc', enabled: true },
  ];
  const s = summarizeFederation(idps);
  // equal counts (1 each) → alphabetical by label: "OpenID Connect" before "SAML 2.0"
  assert.deepEqual(
    s.byType.map((t) => t.providerId),
    ['oidc', 'saml'],
  );
});

// ── exported catalogs are the single source of truth ──────────────────────────────────

test('exported OTP enum catalogs match the validator', () => {
  assert.deepEqual([...OTP_POLICY_TYPES], ['totp', 'hotp']);
  assert.deepEqual([...OTP_POLICY_ALGORITHMS], ['HmacSHA1', 'HmacSHA256', 'HmacSHA512']);
  assert.deepEqual([...OTP_POLICY_DIGITS], [6, 8]);
});
