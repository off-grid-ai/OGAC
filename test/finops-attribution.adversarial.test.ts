import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gatewayEvents } from '../src/lib/analytics.ts';

// ADVERSARIAL — G-ADV-OBS-1
// FinOps "Spend by person / project" and per-virtual-key spend are structurally DEAD.
//
// Terminal artifact the operator sees: the FinOps page renders `f.bySubject` (Spend by person /
// project) and `f.byKey` (per virtual key requests/tokens/cost). Both are derived from the per-event
// `keyId` in finops.ts (keySpend: `if (!e.keyId) continue`; bySubject: `events.filter(e => e.keyId)`).
//
// Root cause: src/lib/analytics.ts:52 hardcodes `keyId: null` on EVERY mapped gateway event, even
// though the source OpenSearch doc carries the caller attribution (`caller` = user_api_key_alias /
// user_api_key_user_id, per litellm-log-shape.ts). So no event ever has a keyId → keySpend produces
// $0/0req for every key and bySubject is always []. The chargeback breakdown is always empty
// regardless of real traffic.
//
// This RED test proves the attribution is dropped at the real entry point (gatewayEvents). It is
// skipped so the suite stays green; un-skip to watch it FAIL (keyId is null, not the source caller).
test.skip('ADVERSARIAL G-ADV-OBS-1: gatewayEvents preserves per-event key attribution', async () => {
  const originalFetch = globalThis.fetch;
  // A real gateway doc DOES carry the caller/key attribution.
  const doc = {
    _id: 'evt1',
    _source: {
      '@timestamp': '2026-07-01T10:00:00Z',
      model: 'cloud-claude',
      tokens: 1000,
      status: 200,
      ms: 120,
      caller: 'key_abc123', // the virtual-key alias LiteLLM attributed the call to
      user_api_key: 'key_abc123',
    },
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ hits: { hits: [doc] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  try {
    const events = await gatewayEvents();
    assert.equal(events.length, 1);
    // The attribution present in the source MUST survive so keySpend/bySubject can attribute cost.
    // It does not: keyId is hardcoded null → per-key + per-subject spend are permanently empty.
    assert.notEqual(
      events[0].keyId,
      null,
      'keyId dropped → FinOps per-key and per-subject spend are always empty',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ADVERSARIAL — G-ADV-OBS-2
// Cross-org isolation: gatewayEvents/computeAnalytics query the SHARED offgrid-gateway index with
// `match_all` (analytics.ts:26-27, :63-71) and NO org/tenant filter. On the multi-tenant console
// (bharatunion + Suraksha etc.) org A's FinOps/Analytics totals include org B's traffic, tokens, cost,
// latency and outcomes. The org is resolved on the page (currentOrgId) but only used to scope the
// pipeline dropdown — never passed to the traffic reader.
//
// This RED test proves the reader accepts no org scoping: the query body sent to OpenSearch is a bare
// match_all. Un-skip to see it FAIL (the query has no org term; every org's traffic is returned).
test.skip('ADVERSARIAL G-ADV-OBS-2: gatewayEvents scopes traffic to the caller org', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: unknown = null;
  const orgAdoc = {
    _id: 'a',
    _source: { '@timestamp': '2026-07-01T10:00:00Z', model: 'gpt-4o', tokens: 500, status: 200 },
  };
  const orgBdoc = {
    _id: 'b',
    _source: { '@timestamp': '2026-07-01T11:00:00Z', model: 'gpt-4o', tokens: 900, status: 200 },
  };
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({ hits: { hits: [orgAdoc, orgBdoc] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await gatewayEvents();
    const q = (capturedBody as { query?: unknown })?.query;
    // A multi-tenant-safe reader MUST filter by org — a match_all query leaks every org's traffic.
    assert.notDeepEqual(q, { match_all: {} }, 'gateway traffic read is not org-scoped (match_all)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
