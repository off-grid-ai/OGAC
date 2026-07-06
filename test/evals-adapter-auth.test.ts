import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  providerAuthFromHeaders,
  selectPromptfooAuth,
  type PromptfooProviderAuth,
} from '../src/lib/adapters/evals.ts';
import { NO_CREDENTIAL, type ServiceCredential } from '../src/lib/service-credentials-lib.ts';

// Gap #30 — the evals promptfoo adapter must authenticate to the gateway through the
// service-credential broker (bearer JWT preferred, legacy static x-api-key fallback) instead of a
// hard-coded key. The unprovisioned placeholder is now sourced from env (not baked into source);
// the pure functions take it as an argument so they stay pure + testable. These exercise the REAL
// pure auth-selection functions (which internally reuse the shared, separately-tested
// `chooseGatewayAuth` rule) with no mocks. The placeholder used in these assertions is arbitrary —
// what matters is it is INJECTED, never a literal in the function body.
const PLACEHOLDER = 'test-unauth-placeholder';

test('broker bearer JWT → promptfoo apiKey carries the raw token (sent as Bearer)', () => {
  const cred: ServiceCredential = { kind: 'bearer', token: 'kc-jwt-abc.def.ghi' };
  const auth = selectPromptfooAuth(cred, 'legacy-static-key', PLACEHOLDER);
  // Bearer wins over the legacy key; the token becomes the provider apiKey (promptfoo → Bearer).
  assert.deepEqual(auth, { apiKey: 'kc-jwt-abc.def.ghi' } satisfies PromptfooProviderAuth);
  assert.equal(auth.headers, undefined);
});

test('no broker cred but a legacy static key → sent as an x-api-key header (aggregator shape)', () => {
  const auth = selectPromptfooAuth(NO_CREDENTIAL, 'static-gateway-key', PLACEHOLDER);
  assert.equal(auth.apiKey, 'x-api-key');
  assert.deepEqual(auth.headers, { 'x-api-key': 'static-gateway-key' });
});

test('unprovisioned: no broker cred AND no legacy key → the INJECTED placeholder, no auth header', () => {
  // Gap #30: the placeholder is whatever the caller injects (env-sourced in prod), NOT a hard-coded
  // key literal in the function body.
  const auth = selectPromptfooAuth(NO_CREDENTIAL, undefined, PLACEHOLDER);
  assert.deepEqual(auth, { apiKey: PLACEHOLDER } satisfies PromptfooProviderAuth);
});

test('bearer with an empty token is NOT treated as auth → falls back to the legacy key', () => {
  const cred = { kind: 'bearer', token: '' } as ServiceCredential;
  const auth = selectPromptfooAuth(cred, 'static-gateway-key', PLACEHOLDER);
  assert.equal(auth.apiKey, 'x-api-key');
  assert.deepEqual(auth.headers, { 'x-api-key': 'static-gateway-key' });
});

// The pure header→provider-config translation on its own (the seam the config builder consumes).
test('providerAuthFromHeaders: Bearer header → apiKey; x-api-key header → passthrough header; empty → injected placeholder', () => {
  assert.deepEqual(providerAuthFromHeaders({ authorization: 'Bearer tok123' }, PLACEHOLDER), {
    apiKey: 'tok123',
  });
  assert.deepEqual(providerAuthFromHeaders({ 'x-api-key': 'k' }, PLACEHOLDER), {
    apiKey: 'x-api-key',
    headers: { 'x-api-key': 'k' },
  });
  assert.deepEqual(providerAuthFromHeaders({}, PLACEHOLDER), { apiKey: PLACEHOLDER });
});
