import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bearerFromHeader,
  legacyDeviceToken,
  timingSafeEqualStr,
  verifyDeviceToken,
} from '../src/lib/device-token.ts';

// Pure device data-plane token logic — no I/O, real functions, real assertions. Locks the auth rules
// the /devices/[id]/{audit,policy,commands} routes depend on (P1 — HARDENING_AUDIT.md).

test('bearerFromHeader strips the scheme case-insensitively and trims', () => {
  assert.equal(bearerFromHeader('Bearer dt_abc'), 'dt_abc');
  assert.equal(bearerFromHeader('bearer   dt_abc  '), 'dt_abc');
  assert.equal(bearerFromHeader('BEARER dt_abc'), 'dt_abc');
});

test('bearerFromHeader returns empty string for absent/malformed headers', () => {
  assert.equal(bearerFromHeader(null), '');
  assert.equal(bearerFromHeader(undefined), '');
  assert.equal(bearerFromHeader(''), '');
});

test('legacyDeviceToken is the predictable dt_<id> form', () => {
  assert.equal(legacyDeviceToken('dev_123'), 'dt_dev_123');
});

test('verifyDeviceToken accepts the exact stored random secret', () => {
  const secret = 'dt_9f8a7b6c5d4e3f2a1b';
  assert.equal(verifyDeviceToken('dev_1', secret, secret), true);
});

test('verifyDeviceToken rejects a wrong secret when the device HAS a stored one', () => {
  const stored = 'dt_realrandomsecret';
  // The legacy predictable form must NOT work once a random secret is stored (upgrade closes it).
  assert.equal(verifyDeviceToken('dev_1', 'dt_dev_1', stored), false);
  assert.equal(verifyDeviceToken('dev_1', 'dt_guess', stored), false);
});

test('verifyDeviceToken is backward-tolerant: no stored secret → accepts legacy dt_<id>', () => {
  assert.equal(verifyDeviceToken('dev_legacy', 'dt_dev_legacy', null), true);
  assert.equal(verifyDeviceToken('dev_legacy', 'dt_dev_legacy', ''), true);
});

test('verifyDeviceToken rejects a wrong legacy token when no secret is stored', () => {
  assert.equal(verifyDeviceToken('dev_legacy', 'dt_other', null), false);
});

test('verifyDeviceToken always rejects an empty presented bearer', () => {
  assert.equal(verifyDeviceToken('dev_1', '', 'dt_secret'), false);
  assert.equal(verifyDeviceToken('dev_1', null, 'dt_secret'), false);
  assert.equal(verifyDeviceToken('dev_1', '', null), false);
});

test('timingSafeEqualStr matches equal strings and rejects on any diff/length', () => {
  assert.equal(timingSafeEqualStr('abc', 'abc'), true);
  assert.equal(timingSafeEqualStr('abc', 'abd'), false);
  assert.equal(timingSafeEqualStr('abc', 'abcd'), false);
  assert.equal(timingSafeEqualStr('', ''), true);
});
