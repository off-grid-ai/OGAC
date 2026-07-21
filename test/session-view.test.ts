import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KcRealmLifetimes } from '../src/lib/keycloak-realm.ts';
import {
  annotateSessionLifetime,
  annotateSessionLifetimes,
  computeSessionLifetime,
  formatAge,
  formatExpiry,
} from '../src/lib/session-view.ts';

const NOW = 1_000_000_000_000; // fixed clock (ms)
const MIN = 60 * 1000;

const LIFETIMES: KcRealmLifetimes = {
  realm: 'offgrid',
  ssoSessionIdleTimeout: 1800, // 30m
  ssoSessionMaxLifespan: 36000, // 10h
  offlineSessionIdleTimeout: 2592000, // 30d
};

test('computeSessionLifetime: age is now - start, never negative', () => {
  const lt = computeSessionLifetime(
    { start: NOW - 10 * MIN, lastAccess: NOW - MIN, offline: false },
    LIFETIMES,
    NOW,
  );
  assert.equal(lt.ageMs, 10 * MIN);

  const future = computeSessionLifetime(
    { start: NOW + 5 * MIN, lastAccess: NOW, offline: false },
    LIFETIMES,
    NOW,
  );
  assert.equal(future.ageMs, 0, 'a start in the future clamps age to 0, not negative');
});

test('computeSessionLifetime: online expiry is the earlier of idle and max cap', () => {
  // lastAccess 5m ago → idle cap at lastAccess + 30m = NOW + 25m.
  // start 9h ago → max cap at start + 10h = NOW + 1h. Idle (25m) is earlier, so it wins.
  const lt = computeSessionLifetime(
    { start: NOW - 9 * 60 * MIN, lastAccess: NOW - 5 * MIN, offline: false },
    LIFETIMES,
    NOW,
  );
  assert.equal(lt.expiresAt, NOW - 5 * MIN + 1800 * 1000);
  assert.equal(lt.ttlMs, 25 * MIN);
  assert.equal(lt.expired, false);
});

test('computeSessionLifetime: online max-lifespan cap wins when it is the earlier bound', () => {
  // Just accessed (idle cap NOW + 30m) but started 9h58m ago → max cap NOW + 2m. Max wins.
  const lt = computeSessionLifetime(
    { start: NOW - (10 * 60 - 2) * MIN, lastAccess: NOW, offline: false },
    LIFETIMES,
    NOW,
  );
  assert.equal(lt.expiresAt, NOW - (10 * 60 - 2) * MIN + 36000 * 1000);
  assert.equal(lt.ttlMs, 2 * MIN);
});

test('computeSessionLifetime: a past expiry is flagged expired', () => {
  const lt = computeSessionLifetime(
    { start: NOW - 40 * MIN, lastAccess: NOW - 40 * MIN, offline: false },
    LIFETIMES,
    NOW,
  );
  assert.ok(lt.ttlMs !== null && lt.ttlMs < 0);
  assert.equal(lt.expired, true);
});

test('computeSessionLifetime: offline sessions use the offline idle timeout only', () => {
  const lt = computeSessionLifetime(
    { start: NOW - 60 * MIN, lastAccess: NOW - 60 * MIN, offline: true },
    LIFETIMES,
    NOW,
  );
  // offline idle 30d from lastAccess (60m ago) → far in the future, not expired.
  assert.equal(lt.expiresAt, NOW - 60 * MIN + 2592000 * 1000);
  assert.equal(lt.expired, false);
});

test('computeSessionLifetime: null lifetimes → age only, expiry unknown', () => {
  const lt = computeSessionLifetime({ start: NOW - MIN, lastAccess: NOW, offline: false }, null, NOW);
  assert.equal(lt.ageMs, MIN);
  assert.equal(lt.expiresAt, null);
  assert.equal(lt.ttlMs, null);
  assert.equal(lt.expired, false);
});

test('computeSessionLifetime: a zero timeout means "no cap" and yields unknown expiry', () => {
  const lt = computeSessionLifetime(
    { start: NOW, lastAccess: NOW, offline: false },
    { realm: 'r', ssoSessionIdleTimeout: 0, ssoSessionMaxLifespan: 0 },
    NOW,
  );
  assert.equal(lt.expiresAt, null, 'both caps at 0 → no projected expiry');
});

test('computeSessionLifetime: offline with no offline idle configured → unknown expiry', () => {
  const lt = computeSessionLifetime(
    { start: NOW, lastAccess: NOW, offline: true },
    { realm: 'r', ssoSessionIdleTimeout: 1800 },
    NOW,
  );
  assert.equal(lt.expiresAt, null);
});

test('annotateSessionLifetime: merges computed fields without mutating the input', () => {
  const input = { id: 's1', start: NOW - MIN, lastAccess: NOW, offline: false };
  const out = annotateSessionLifetime(input, LIFETIMES, NOW);
  assert.equal(out.id, 's1');
  assert.equal(out.ageMs, MIN);
  assert.ok('expiresAt' in out);
  assert.equal((input as Record<string, unknown>).ageMs, undefined, 'input untouched');
});

test('annotateSessionLifetimes: annotates every row', () => {
  const rows = [
    { id: 'a', start: NOW - MIN, lastAccess: NOW, offline: false },
    { id: 'b', start: NOW - 2 * MIN, lastAccess: NOW, offline: true },
  ];
  const out = annotateSessionLifetimes(rows, LIFETIMES, NOW);
  assert.equal(out.length, 2);
  assert.equal(out[0].ageMs, MIN);
  assert.equal(out[1].ageMs, 2 * MIN);
});

test('formatAge: whole seconds, em-dash for negative', () => {
  assert.equal(formatAge(90 * 1000), '1m 30s');
  assert.equal(formatAge(-5), '—');
  assert.equal(formatAge(0), '0s');
});

test('formatExpiry: unknown, expired, and a positive TTL', () => {
  assert.equal(formatExpiry(null), '—');
  assert.equal(formatExpiry(0), 'expired');
  assert.equal(formatExpiry(-1000), 'expired');
  assert.equal(formatExpiry(25 * MIN), 'in 25m');
});
