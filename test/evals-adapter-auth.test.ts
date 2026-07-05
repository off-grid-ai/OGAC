import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  providerAuthFromHeaders,
  selectPromptfooAuth,
  type PromptfooProviderAuth,
} from '../src/lib/adapters/evals.ts';
import { NO_CREDENTIAL, type ServiceCredential } from '../src/lib/service-credentials-lib.ts';

// Gap #30 — the evals promptfoo adapter must authenticate to the gateway through the
// service-credential broker (bearer JWT preferred, legacy static x-api-key fallback) instead of the
// old hard-coded `apiKey:'offgrid-local'`. These exercise the REAL pure auth-selection functions
// (which internally reuse the shared, separately-tested `chooseGatewayAuth` rule) with no mocks.

test('broker bearer JWT → promptfoo apiKey carries the raw token (sent as Bearer)', () => {
  const cred: ServiceCredential = { kind: 'bearer', token: 'kc-jwt-abc.def.ghi' };
  const auth = selectPromptfooAuth(cred, 'legacy-static-key');
  // Bearer wins over the legacy key; the token becomes the provider apiKey (promptfoo → Bearer).
  assert.deepEqual(auth, { apiKey: 'kc-jwt-abc.def.ghi' } satisfies PromptfooProviderAuth);
  assert.equal(auth.headers, undefined);
});

test('no broker cred but a legacy static key → sent as an x-api-key header (aggregator shape)', () => {
  const auth = selectPromptfooAuth(NO_CREDENTIAL, 'static-gateway-key');
  assert.equal(auth.apiKey, 'x-api-key');
  assert.deepEqual(auth.headers, { 'x-api-key': 'static-gateway-key' });
});

test('unprovisioned: no broker cred AND no legacy key → placeholder key, no auth header (byte-identical to old default)', () => {
  const auth = selectPromptfooAuth(NO_CREDENTIAL, undefined);
  assert.deepEqual(auth, { apiKey: 'offgrid-local' } satisfies PromptfooProviderAuth);
});

test('bearer with an empty token is NOT treated as auth → falls back to the legacy key', () => {
  const cred = { kind: 'bearer', token: '' } as ServiceCredential;
  const auth = selectPromptfooAuth(cred, 'static-gateway-key');
  assert.equal(auth.apiKey, 'x-api-key');
  assert.deepEqual(auth.headers, { 'x-api-key': 'static-gateway-key' });
});

// The pure header→provider-config translation on its own (the seam the config builder consumes).
test('providerAuthFromHeaders: Bearer header → apiKey; x-api-key header → passthrough header; empty → placeholder', () => {
  assert.deepEqual(providerAuthFromHeaders({ authorization: 'Bearer tok123' }), { apiKey: 'tok123' });
  assert.deepEqual(providerAuthFromHeaders({ 'x-api-key': 'k' }), {
    apiKey: 'x-api-key',
    headers: { 'x-api-key': 'k' },
  });
  assert.deepEqual(providerAuthFromHeaders({}), { apiKey: 'offgrid-local' });
});
