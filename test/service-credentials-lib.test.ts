import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGrantRequest,
  clientSecretKey,
  computeCacheEntry,
  decodeJwtExp,
  isRefreshDue,
  normalizeService,
  parseGrantResponse,
  resolveTokenEndpoint,
  s3AccessKeyKey,
  s3SecretKeyKey,
  type ParsedGrant,
} from '../src/lib/service-credentials-lib.ts';

// Unit tests for the PURE service-credential broker logic — NO mocks, NO I/O, NO network. Real JWTs
// are built here (base64url payloads) so exp parsing is exercised against genuine token shapes.

// Build a real, unsigned-but-well-formed JWT with the given payload for decodeJwtExp tests.
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

test('normalizeService trims and lowercases', () => {
  assert.equal(normalizeService('  Gateway '), 'gateway');
  assert.equal(normalizeService('SeaweedFS'), 'seaweedfs');
});

test('OpenBao key builders follow secret/<service>/<leaf> convention', () => {
  assert.equal(clientSecretKey('gateway'), 'gateway/client-secret');
  assert.equal(clientSecretKey('  FLEET '), 'fleet/client-secret');
  assert.equal(s3AccessKeyKey('seaweedfs'), 'seaweedfs/s3-access-key');
  assert.equal(s3SecretKeyKey('seaweedfs'), 'seaweedfs/s3-secret-key');
});

test('resolveTokenEndpoint prefers base+realm, then issuer, else null', () => {
  assert.equal(
    resolveTokenEndpoint({ keycloakUrl: 'http://offgrid-s1.local:8080', realm: 'offgrid' }),
    'http://offgrid-s1.local:8080/realms/offgrid/protocol/openid-connect/token',
  );
  // trailing slashes stripped
  assert.equal(
    resolveTokenEndpoint({ keycloakUrl: 'http://kc/', realm: 'offgrid' }),
    'http://kc/realms/offgrid/protocol/openid-connect/token',
  );
  // issuer fallback (issuer already IS the realm url)
  assert.equal(
    resolveTokenEndpoint({ issuer: 'https://auth.example.com/realms/offgrid' }),
    'https://auth.example.com/realms/offgrid/protocol/openid-connect/token',
  );
  // base+realm wins over issuer when both present
  assert.equal(
    resolveTokenEndpoint({ keycloakUrl: 'http://kc', realm: 'r', issuer: 'https://x/realms/y' }),
    'http://kc/realms/r/protocol/openid-connect/token',
  );
  assert.equal(resolveTokenEndpoint({}), null);
  assert.equal(resolveTokenEndpoint({ keycloakUrl: 'http://kc' }), null); // realm missing
});

test('buildGrantRequest shapes a client_credentials body + form header', () => {
  const req = buildGrantRequest('offgrid-gateway', 's3cr3t');
  assert.equal(req.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(req.body);
  assert.equal(params.get('grant_type'), 'client_credentials');
  assert.equal(params.get('client_id'), 'offgrid-gateway');
  assert.equal(params.get('client_secret'), 's3cr3t');
  assert.equal(params.get('scope'), null);
});

test('buildGrantRequest includes optional scope + audience', () => {
  const req = buildGrantRequest('c', 's', { scope: 'openid profile', audience: 'gateway' });
  const params = new URLSearchParams(req.body);
  assert.equal(params.get('scope'), 'openid profile');
  assert.equal(params.get('audience'), 'gateway');
});

test('parseGrantResponse reads token + expires_in, defaults bad exp to 60s', () => {
  assert.deepEqual(parseGrantResponse({ access_token: 'abc', expires_in: 300 }), {
    token: 'abc',
    expiresIn: 300,
  });
  assert.equal(parseGrantResponse({ access_token: 'abc' }).expiresIn, 60);
  assert.equal(parseGrantResponse({ access_token: 'abc', expires_in: -5 }).expiresIn, 60);
  assert.equal(parseGrantResponse({ access_token: 'abc', expires_in: 'x' as unknown as number }).expiresIn, 60);
});

test('parseGrantResponse throws when no access_token', () => {
  assert.throws(() => parseGrantResponse({ expires_in: 300 }), /no access_token/);
  assert.throws(() => parseGrantResponse(null), /no access_token/);
  assert.throws(() => parseGrantResponse({ access_token: 42 as unknown as string }), /no access_token/);
});

test('decodeJwtExp reads exp from a real JWT payload', () => {
  const exp = 1_900_000_000;
  assert.equal(decodeJwtExp(makeJwt({ sub: 'svc', exp })), exp);
});

test('decodeJwtExp returns null for malformed / exp-less tokens', () => {
  assert.equal(decodeJwtExp('not-a-jwt'), null);
  assert.equal(decodeJwtExp(''), null);
  assert.equal(decodeJwtExp(makeJwt({ sub: 'svc' })), null); // no exp
  assert.equal(decodeJwtExp('a.@@@notbase64@@@.c'), null);
});

test('computeCacheEntry prefers JWT exp over expires_in, sets refresh at 80%', () => {
  const now = 1_000_000_000_000; // ms
  const grant: ParsedGrant = { token: 't', expiresIn: 300 };
  const jwtExpSec = now / 1000 + 100; // exp is 100s out → authoritative
  const entry = computeCacheEntry(now, grant, jwtExpSec);
  assert.equal(entry.token, 't');
  assert.equal(entry.expiresAtMs, jwtExpSec * 1000); // exp wins over 300s expires_in
  // lifetime 100s, 80% → refresh 80s after now
  assert.equal(entry.refreshAtMs, now + 80_000);
});

test('computeCacheEntry falls back to expires_in when no JWT exp', () => {
  const now = 2_000_000_000_000;
  const entry = computeCacheEntry(now, { token: 't', expiresIn: 300 }, null);
  assert.equal(entry.expiresAtMs, now + 300_000);
  assert.equal(entry.refreshAtMs, now + 240_000); // 80% of 300s
});

test('computeCacheEntry honors a custom refresh fraction, clamped to 0..1', () => {
  const now = 0;
  assert.equal(computeCacheEntry(now, { token: 't', expiresIn: 100 }, null, 0.5).refreshAtMs, 50_000);
  // clamp >1 to 1 (refresh at expiry)
  assert.equal(computeCacheEntry(now, { token: 't', expiresIn: 100 }, null, 5).refreshAtMs, 100_000);
  // clamp <0 to 0 (refresh immediately)
  assert.equal(computeCacheEntry(now, { token: 't', expiresIn: 100 }, null, -1).refreshAtMs, 0);
});

test('computeCacheEntry never schedules a refresh in the past for an already-expired grant', () => {
  const now = 5_000;
  const jwtExpSec = 4; // exp is BEFORE now → lifetime clamps to 0
  const entry = computeCacheEntry(now, { token: 't', expiresIn: 300 }, jwtExpSec);
  assert.equal(entry.refreshAtMs, now); // never < now
  assert.ok(entry.expiresAtMs < now);
});

test('isRefreshDue: null entry, past refresh point, and expired all read as due', () => {
  const now = 1_000_000;
  assert.equal(isRefreshDue(null, now), true);
  assert.equal(isRefreshDue(undefined, now), true);
  // fresh: refresh in the future, not expired → NOT due
  assert.equal(
    isRefreshDue({ token: 't', refreshAtMs: now + 10, expiresAtMs: now + 100 }, now),
    false,
  );
  // past refresh point → due
  assert.equal(
    isRefreshDue({ token: 't', refreshAtMs: now - 1, expiresAtMs: now + 100 }, now),
    true,
  );
  // expired even if refreshAt somehow in future → due
  assert.equal(
    isRefreshDue({ token: 't', refreshAtMs: now + 100, expiresAtMs: now - 1 }, now),
    true,
  );
  // exactly at refresh point → due (>=)
  assert.equal(
    isRefreshDue({ token: 't', refreshAtMs: now, expiresAtMs: now + 100 }, now),
    true,
  );
});

// End-to-end lifecycle over the PURE surface: mint → cache → still-fresh → past-80% → refresh.
test('lifecycle: a token stays cached until 80% elapsed, then is due', () => {
  const t0 = 1_700_000_000_000;
  const grant = parseGrantResponse({ access_token: makeJwt({ exp: t0 / 1000 + 300 }), expires_in: 300 });
  const entry = computeCacheEntry(t0, grant, decodeJwtExp(grant.token));
  // just after mint → fresh
  assert.equal(isRefreshDue(entry, t0 + 1_000), false);
  // at 79% (237s) → still fresh
  assert.equal(isRefreshDue(entry, t0 + 237_000), false);
  // at 80% (240s) → due
  assert.equal(isRefreshDue(entry, t0 + 240_000), true);
});
