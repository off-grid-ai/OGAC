import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REQUIRED_WORKER_ENV, missingRequiredEnv } from '../scripts/worker-env.mts';

// Pure-logic unit tests for the worker's env presence check. Importing worker-env runs its
// loadEnvConfig side effect (harmless here — it just loads the repo's .env into process.env), but
// missingRequiredEnv itself takes an explicit env map, so these assertions never touch process.env.

test('missingRequiredEnv: all present → empty', () => {
  const env = {
    DATABASE_URL: 'postgresql://u:pw@h:5432/db',
    OFFGRID_GATEWAY_URL: 'http://gw:8800',
    OFFGRID_GATEWAY_API_KEY: 'k',
  };
  assert.deepEqual(missingRequiredEnv(env), []);
});

test('missingRequiredEnv: DATABASE_URL missing → reported (the live SASL crash)', () => {
  const env = { OFFGRID_GATEWAY_URL: 'http://gw:8800', OFFGRID_GATEWAY_API_KEY: 'k' };
  assert.deepEqual(missingRequiredEnv(env), ['DATABASE_URL']);
});

test('missingRequiredEnv: blank/whitespace counts as missing', () => {
  const env = {
    DATABASE_URL: '',
    OFFGRID_GATEWAY_URL: '   ',
    OFFGRID_GATEWAY_API_KEY: 'k',
  };
  assert.deepEqual(missingRequiredEnv(env), ['DATABASE_URL', 'OFFGRID_GATEWAY_URL']);
});

test('missingRequiredEnv: undefined value counts as missing', () => {
  const env: Record<string, string | undefined> = {
    DATABASE_URL: undefined,
    OFFGRID_GATEWAY_URL: 'http://gw:8800',
    OFFGRID_GATEWAY_API_KEY: 'k',
  };
  assert.deepEqual(missingRequiredEnv(env), ['DATABASE_URL']);
});

test('missingRequiredEnv: empty env → all required reported', () => {
  assert.deepEqual(missingRequiredEnv({}), [...REQUIRED_WORKER_ENV]);
});

test('missingRequiredEnv: honours a custom required list', () => {
  assert.deepEqual(missingRequiredEnv({ FOO: 'x' }, ['FOO', 'BAR']), ['BAR']);
});

test('REQUIRED_WORKER_ENV: includes DATABASE_URL + gateway creds', () => {
  const required: readonly string[] = REQUIRED_WORKER_ENV;
  assert.ok(required.includes('DATABASE_URL'));
  assert.ok(required.includes('OFFGRID_GATEWAY_URL'));
  assert.ok(required.includes('OFFGRID_GATEWAY_API_KEY'));
});
