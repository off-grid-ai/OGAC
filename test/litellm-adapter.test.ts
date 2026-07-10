import assert from 'node:assert/strict';
import { test } from 'node:test';

// LiteLLM adapter. The adapter reads OFFGRID_LITELLM_URL at module load, so the two configured/unset
// worlds are exercised via SEPARATE dynamic imports with a cache-busting query (node caches by URL).
// The pure shapers (shapeDeployments / shapeKeyBudget) are tested directly; safeRouterView is driven
// with an INJECTED fetch (real function, fake transport) — no live proxy, no heavy mocking.

// A minimal fetch stub: maps a path suffix → a Response-like object. Never a network call.
type Route = { status?: number; body?: unknown; throws?: boolean };
function stubFetch(routes: Record<string, Route>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    const key = Object.keys(routes).find((k) => u.endsWith(k));
    const r = key ? routes[key] : { status: 404, body: {} };
    if (r.throws) throw new Error('network down');
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.body ?? {},
    } as Response;
  }) as typeof fetch;
}

test('unset OFFGRID_LITELLM_URL → configured:false, empty view (never throws)', async () => {
  delete process.env.OFFGRID_LITELLM_URL;
  const mod = await import('../src/lib/litellm.ts?unset');
  assert.equal(mod.litellmConfigured(), false);
  const view = await mod.safeRouterView(stubFetch({}));
  assert.deepEqual(view, { configured: false, live: false, deployments: [], budgets: [] });
});

test('configured + live proxy → deployments merged with health + a budget row', async () => {
  process.env.OFFGRID_LITELLM_URL = 'http://litellm.test:4000';
  process.env.OFFGRID_LITELLM_MASTER_KEY = 'sk-master';
  const mod = await import('../src/lib/litellm.ts?live');
  assert.equal(mod.litellmConfigured(), true);

  const view = await mod.safeRouterView(
    stubFetch({
      '/health/liveliness': { body: 'I am alive!' },
      '/model/info': {
        body: {
          data: [
            {
              model_name: 'onprem/qwythos-9b',
              litellm_params: { api_base: 'http://10.0.0.1:7878/v1' },
              model_info: { id: 'g1', egress: 'on-prem', vision: true },
            },
            {
              model_name: 'openai/gpt-4o-mini',
              litellm_params: { api_base: 'https://api.openai.com/v1' },
              model_info: { id: 'openai', egress: 'cloud', vision: false },
            },
          ],
        },
      },
      '/health': {
        body: {
          healthy_endpoints: [{ model_info: { id: 'g1' } }],
          unhealthy_endpoints: [{ model_info: { id: 'openai' } }],
        },
      },
      '/key/info': {
        body: { info: { key_alias: 'master', spend: 1.5, max_budget: 100, rpm_limit: 60, tpm_limit: null } },
      },
    }),
  );

  assert.equal(view.configured, true);
  assert.equal(view.live, true);
  assert.equal(view.deployments.length, 2);
  const g1 = view.deployments.find((d) => d.id === 'g1')!;
  assert.equal(g1.health, 'healthy');
  assert.equal(g1.egress, 'on-prem');
  assert.equal(g1.vision, true);
  const oa = view.deployments.find((d) => d.id === 'openai')!;
  assert.equal(oa.health, 'unhealthy');
  assert.equal(oa.egress, 'cloud');
  assert.equal(view.budgets.length, 1);
  assert.equal(view.budgets[0].spend, 1.5);
  assert.equal(view.budgets[0].maxBudget, 100);
  assert.equal(view.budgets[0].rpmLimit, 60);
  assert.equal(view.budgets[0].tpmLimit, null);
});

test('configured but proxy unreachable (liveliness throws) → live:false, empty, graceful error', async () => {
  process.env.OFFGRID_LITELLM_URL = 'http://litellm.test:4000';
  const mod = await import('../src/lib/litellm.ts?down');
  const view = await mod.safeRouterView(stubFetch({ '/health/liveliness': { throws: true } }));
  assert.equal(view.configured, true);
  assert.equal(view.live, false);
  assert.deepEqual(view.deployments, []);
  assert.ok(view.error);
});

test('live but /model/info fails → live:true, deployments empty (section degrades only)', async () => {
  process.env.OFFGRID_LITELLM_URL = 'http://litellm.test:4000';
  const mod = await import('../src/lib/litellm.ts?partial');
  const view = await mod.safeRouterView(
    stubFetch({
      '/health/liveliness': { body: 'ok' },
      '/model/info': { throws: true },
      '/key/info': { body: { info: { key_alias: 'k', spend: 0 } } },
    }),
  );
  assert.equal(view.live, true);
  assert.deepEqual(view.deployments, []);
  // budgets still read successfully
  assert.equal(view.budgets.length, 1);
});

test('live but /key/info fails → budgets empty (no throw)', async () => {
  process.env.OFFGRID_LITELLM_URL = 'http://litellm.test:4000';
  const mod = await import('../src/lib/litellm.ts?nobudget');
  const view = await mod.safeRouterView(
    stubFetch({
      '/health/liveliness': { body: 'ok' },
      '/model/info': { body: { data: [] } },
      '/health': { body: {} },
      '/key/info': { throws: true },
    }),
  );
  assert.equal(view.live, true);
  assert.deepEqual(view.budgets, []);
});

// ─── pure shapers, driven directly ──────────────────────────────────────────────────────────────
test('shapeDeployments: unknown egress + not-in-health-lists → egress unknown, health unknown', async () => {
  const mod = await import('../src/lib/litellm.ts?shape');
  const rows = mod.shapeDeployments(
    [{ model_name: 'x', litellm_params: { api_base: 'b' }, model_info: { id: 'x', egress: 'weird' } }],
    [],
    [],
  );
  assert.equal(rows[0].egress, 'unknown');
  assert.equal(rows[0].health, 'unknown');
  assert.equal(rows[0].modelName, 'x');
  assert.equal(rows[0].apiBase, 'b');
});

test('shapeDeployments: falls back to model_name when model_info.id is absent', async () => {
  const mod = await import('../src/lib/litellm.ts?shape2');
  const rows = mod.shapeDeployments([{ model_name: 'onprem/m' }], [{ model_name: 'onprem/m' }], []);
  assert.equal(rows[0].id, 'onprem/m');
  assert.equal(rows[0].health, 'healthy');
  assert.equal(rows[0].apiBase, '');
  assert.equal(rows[0].vision, false);
});

test('shapeDeployments: no id anywhere → "unknown"', async () => {
  const mod = await import('../src/lib/litellm.ts?shape3');
  const rows = mod.shapeDeployments([{}], [], []);
  assert.equal(rows[0].id, 'unknown');
});

test('shapeKeyBudget: numeric coercion + null passthrough for unbounded limits', async () => {
  const mod = await import('../src/lib/litellm.ts?budget');
  const b = mod.shapeKeyBudget({ key_alias: null, spend: undefined, max_budget: null });
  assert.equal(b.keyAlias, null);
  assert.equal(b.spend, 0);
  assert.equal(b.maxBudget, null);
  assert.equal(b.rpmLimit, null);
});
