import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

// Adapter test for adapters/opa-audit.ts — the NETWORK seam. We fake ONLY the device boundary
// (global.fetch) so the real adapter code (URL building, JSON parsing, honest reachable/error
// mapping) runs against representative OPA responses. No mocking of our own modules; the pure
// normalizers run for real underneath.

const realFetch = globalThis.fetch;
const realUrl = process.env.OFFGRID_OPA_URL;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realUrl === undefined) delete process.env.OFFGRID_OPA_URL;
  else process.env.OFFGRID_OPA_URL = realUrl;
});

function fakeFetch(routes: Record<string, { ok: boolean; status?: number; body: unknown }>) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const match = Object.keys(routes).find((p) => url.endsWith(p));
    if (!match) throw new Error(`unexpected fetch ${url}`);
    const r = routes[match];
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
    } as Response;
  }) as typeof fetch;
}

test('adapter: OFFGRID_OPA_URL unset → every reader unreachable', async () => {
  delete process.env.OFFGRID_OPA_URL;
  const { readOpaConfig, readBundleStatus, readLoadedPolicies, readBundleView } = await import(
    '@/lib/adapters/opa-audit'
  );
  const cfg = await readOpaConfig();
  assert.equal('reachable' in cfg && cfg.reachable, false);
  assert.equal((await readBundleStatus()).reachable, false);
  assert.equal((await readLoadedPolicies()).reachable, false);
  const view = await readBundleView();
  assert.equal(view.configured, false);
  assert.match(view.reason, /not set/);
  assert.equal(view.config, null);
  assert.deepEqual(view.policies, []);
});

test('adapter: live-shaped responses normalize through the real reader', async () => {
  process.env.OFFGRID_OPA_URL = 'http://opa.test:8181';
  fakeFetch({
    '/v1/config': {
      ok: true,
      body: {
        result: {
          default_decision: '/system/main',
          default_authorization_decision: '/system/authz/allow',
          labels: { id: 'node-1', version: '0.70.0' },
        },
      },
    },
    // status plugin disabled — OPA returns 500 + a JSON error body; adapter still parses it
    '/v1/status': {
      ok: false,
      status: 500,
      body: { code: 'internal_error', message: 'status plugin not enabled' },
    },
    '/v1/policies': {
      ok: true,
      body: {
        result: [
          {
            id: 'offgrid_authz',
            raw: 'package offgrid.authz\ndefault allow := false\n',
            ast: {
              package: {
                path: [
                  { type: 'var', value: 'data' },
                  { type: 'string', value: 'offgrid' },
                  { type: 'string', value: 'authz' },
                ],
              },
              rules: [{}, {}],
            },
          },
        ],
      },
    },
  });
  const { readBundleView } = await import('@/lib/adapters/opa-audit');
  const view = await readBundleView();
  assert.equal(view.configured, true);
  assert.equal(view.reason, '');
  assert.equal(view.config?.decisionLogsConfigured, false);
  assert.deepEqual(view.config?.bundles, []);
  assert.equal(view.status?.statusPluginEnabled, false);
  assert.equal(view.policies.length, 1);
  assert.equal(view.policies[0].package, 'offgrid.authz');
  assert.equal(view.policies[0].ruleCount, 2);
});

test('adapter: network error → unreachable with the error reason', async () => {
  process.env.OFFGRID_OPA_URL = 'http://opa.test:8181';
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  const { readOpaConfig, readBundleView } = await import('@/lib/adapters/opa-audit');
  const cfg = await readOpaConfig();
  assert.equal(cfg.reachable, false);
  assert.match((cfg as { reason: string }).reason, /ECONNREFUSED/);
  const view = await readBundleView();
  assert.equal(view.configured, false);
  assert.match(view.reason, /ECONNREFUSED/);
});

test('adapter: non-2xx with unparseable body → unreachable OPA <status>', async () => {
  process.env.OFFGRID_OPA_URL = 'http://opa.test:8181';
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not json');
      },
    }) as unknown as Response) as typeof fetch;
  const { readOpaConfig } = await import('@/lib/adapters/opa-audit');
  const cfg = await readOpaConfig();
  assert.equal(cfg.reachable, false);
  assert.match((cfg as { reason: string }).reason, /OPA 503/);
});
