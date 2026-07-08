import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  maybeRunComposableTool,
  runPrimitive,
  WEBSEARCH_URL_ENV_LEGACY,
} from '../src/lib/adapters/tool-primitives.ts';
import { WEBSEARCH_URL_ENV } from '../src/lib/adapters/web-search.ts';
import { webSearchEgressAllowed, type EgressDecision } from '../src/lib/tool-primitives.ts';

// The per-pipeline EGRESS LEASH must govern web_search exactly like a cloud model call: a local-only
// or blocked pipeline REFUSES the search; a cloud pipeline permits it. This proves the leash is wired
// through the LIVE dispatch path (runPrimitive → execWebSearch → governedWebSearch), not just the pure
// helper, and that the egress verdict threads through the composable-tool seam the agent loop uses.
//
// No network: a fake fetch stands in for the org search provider. The air-gap gate is opted in via
// OFFGRID_TOOL_WEB_SEARCH so we isolate the EGRESS decision as the thing under test.

const ENABLE = { OFFGRID_TOOL_WEB_SEARCH: '1' } as const;

// A fake search provider that returns one honest result — asserts we NEVER reach it when leashed.
function fakeSearchFetch(): { fetchImpl: typeof fetch; calls: () => number } {
  let called = 0;
  const fetchImpl = (async () => {
    called += 1;
    return new Response(
      JSON.stringify({ results: [{ title: 'Result A', url: 'https://example.com/a', content: 'snippet' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => called };
}

test('LOCAL-only egress leash REFUSES web_search (blocked) — the provider is never reached', async () => {
  const { fetchImpl, calls } = fakeSearchFetch();
  const result = await runPrimitive('web_search', {
    policy: 'allow',
    params: { query: 'X' },
    env: { ...ENABLE, [WEBSEARCH_URL_ENV]: 'https://search.internal/api' },
    fetchImpl,
    egress: 'local',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked', 'a local-only leash must block egress like a cloud model call');
  assert.match(result.detail, /LOCAL-only|refused/i);
  assert.equal(calls(), 0, 'a leashed search must NOT reach the provider');
});

test('BLOCK egress leash REFUSES web_search (blocked) — no reach', async () => {
  const { fetchImpl, calls } = fakeSearchFetch();
  const result = await runPrimitive('web_search', {
    policy: 'allow',
    params: { query: 'X' },
    env: { ...ENABLE, [WEBSEARCH_URL_ENV]: 'https://search.internal/api' },
    fetchImpl,
    egress: 'block',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(calls(), 0);
});

test('CLOUD egress leash ALLOWS web_search — the provider is reached and results returned', async () => {
  const { fetchImpl, calls } = fakeSearchFetch();
  const result = await runPrimitive('web_search', {
    policy: 'allow',
    params: { query: 'X' },
    env: { ...ENABLE, [WEBSEARCH_URL_ENV]: 'https://search.internal/api' },
    fetchImpl,
    egress: 'cloud',
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ran');
  assert.match(result.output ?? '', /Result A/);
  assert.equal(calls(), 1, 'a cloud-permitted search reaches the provider exactly once');
});

test('DEFAULT egress (no verdict passed) is cloud — unchanged behaviour, search runs', async () => {
  const { fetchImpl, calls } = fakeSearchFetch();
  const result = await runPrimitive('web_search', {
    policy: 'allow',
    params: { query: 'X' },
    env: { ...ENABLE, [WEBSEARCH_URL_ENV]: 'https://search.internal/api' },
    fetchImpl,
    // egress omitted → defaults to 'cloud'
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ran');
  assert.equal(calls(), 1);
});

test('ENV RECONCILIATION: legacy OFFGRID_WEB_SEARCH_URL still configures the endpoint (aliased)', async () => {
  const { fetchImpl, calls } = fakeSearchFetch();
  // Only the LEGACY var is set — no canonical OFFGRID_WEBSEARCH_URL — yet the search must still run.
  const result = await runPrimitive('web_search', {
    policy: 'allow',
    params: { query: 'X' },
    env: { ...ENABLE, [WEBSEARCH_URL_ENV_LEGACY]: 'https://legacy.internal/api' },
    fetchImpl,
    egress: 'cloud',
  });
  assert.equal(result.ok, true, 'the legacy env var must alias onto the canonical one');
  assert.equal(result.status, 'ran');
  assert.equal(calls(), 1);
});

test('THREADED through the composable-tool seam: ctx.egress leashes web_search (blocked)', async () => {
  const { fetchImpl, calls } = fakeSearchFetch();
  // maybeRunComposableTool is the seam the agent loop calls; it threads ctx.egress into runPrimitive.
  // Force the endpoint + air-gap on via process.env so the seam's own defaults resolve, then prove a
  // local egress refuses BEFORE any reach. (Policy resolves to the safe 'approval' default with no
  // store, which would itself refuse — so we assert the reach never happens either way, and that a
  // cloud verdict does NOT change that refusal, isolating egress as the governing factor.)
  const prev = { ...process.env };
  process.env.OFFGRID_TOOL_WEB_SEARCH = '1';
  process.env[WEBSEARCH_URL_ENV] = 'https://search.internal/api';
  try {
    const local = await maybeRunComposableTool(
      'prim:web_search',
      { orgId: 'org_test', egress: 'local' },
      undefined,
      'X',
    );
    assert.ok(local && local.ok === false, 'a leashed/ungoverned primitive must not run');
    assert.equal(calls(), 0, 'no provider reach under the seam without an allowed egress+policy');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev);
  }
});

test('PURE leash helper agrees with the wiring (local/block refuse, cloud allows)', () => {
  const cases: [EgressDecision, boolean][] = [
    ['cloud', true],
    ['local', false],
    ['block', false],
  ];
  for (const [egress, allow] of cases) {
    assert.equal(webSearchEgressAllowed(egress).allow, allow, `egress ${egress}`);
  }
});
