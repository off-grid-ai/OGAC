import assert from 'node:assert/strict';
import { test } from 'node:test';

// Injected-fetch adapter tests for the three observability read adapters. The adapters read their
// base URL from env at module load, so each configured suite sets the env var BEFORE a dynamic
// import (and uses a query string on the import specifier to defeat the module cache between the
// unconfigured and configured cases). A fake fetch stands in for the live server — exercising the
// real fetch→parse→shape path without a network, per the "mocks sparingly" bar (this is the one
// genuine I/O seam, injected exactly so it stays testable).

// A fake fetch that returns a given body/status. Records the URL it was called with.
function fakeFetch(opts: { status?: number; body?: string; json?: unknown; throwCode?: string }) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(String(url));
    if (opts.throwCode) {
      const e = new Error('fetch failed') as Error & { cause?: { code?: string } };
      e.cause = { code: opts.throwCode };
      throw e;
    }
    const status = opts.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => opts.json ?? {},
      text: async () => opts.body ?? '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// ── VictoriaMetrics ─────────────────────────────────────────────────────────────
test('victoria-metrics: unconfigured → configured:false, no charts, no throw', async () => {
  delete process.env.OFFGRID_VICTORIAMETRICS_URL;
  const mod = await import('../src/lib/victoria-metrics.ts?vm-unset');
  assert.equal(mod.victoriaMetricsConfigured(), false);
  const r = await mod.safePlatformMetrics();
  assert.equal(r.configured, false);
  assert.deepEqual(r.charts, []);
  assert.equal(r.targetsUp, null);
});

test('victoria-metrics: configured + live data → shaped charts + targetsUp', async () => {
  process.env.OFFGRID_VICTORIAMETRICS_URL = 'http://vm.test';
  const mod = await import('../src/lib/victoria-metrics.ts?vm-live');
  assert.equal(mod.victoriaMetricsConfigured(), true);
  const { fn } = fakeFetch({
    json: {
      data: { resultType: 'matrix', result: [{ metric: { service: 'gw' }, values: [[1, '3']] }] },
    },
  });
  const r = await mod.safePlatformMetrics(fn, new Date(2_000_000));
  assert.equal(r.configured, true);
  assert.equal(r.charts.length, mod.PLATFORM_CHARTS.length);
  assert.ok(r.charts.every((c: { emitting: boolean }) => c.emitting));
  assert.equal(r.targetsUp, 3);
});

test('victoria-metrics: reachable but a chart query errors → honest empty chart, not a throw', async () => {
  process.env.OFFGRID_VICTORIAMETRICS_URL = 'http://vm.test';
  const mod = await import('../src/lib/victoria-metrics.ts?vm-err');
  const { fn } = fakeFetch({ status: 422, body: 'bad query' });
  const r = await mod.safePlatformMetrics(fn, new Date(2_000_000));
  assert.equal(r.configured, true);
  assert.ok(r.charts.every((c: { emitting: boolean; error?: string }) => !c.emitting));
});

test('victoria-metrics: safeInstantQuery shapes an ad-hoc query', async () => {
  process.env.OFFGRID_VICTORIAMETRICS_URL = 'http://vm.test';
  const mod = await import('../src/lib/victoria-metrics.ts?vm-instant');
  const { fn, calls } = fakeFetch({
    json: { data: { resultType: 'vector', result: [{ metric: {}, value: [1, '9'] }] } },
  });
  const c = await mod.safeInstantQuery('up', fn);
  assert.equal(c.emitting, true);
  assert.ok(calls[0].includes('/api/v1/query?query=up'));
});

// ── VictoriaLogs ─────────────────────────────────────────────────────────────────
test('victoria-logs: unconfigured → configured:false, empty rows, query normalized', async () => {
  delete process.env.OFFGRID_VICTORIALOGS_URL;
  const mod = await import('../src/lib/victoria-logs.ts?vl-unset');
  assert.equal(mod.victoriaLogsConfigured(), false);
  const r = await mod.safeSearchLogs('');
  assert.equal(r.configured, false);
  assert.deepEqual(r.rows, []);
  assert.equal(r.query, '*'); // empty normalizes to match-all
});

test('victoria-logs: configured + JSONL body → parsed rows', async () => {
  process.env.OFFGRID_VICTORIALOGS_URL = 'http://vl.test';
  const mod = await import('../src/lib/victoria-logs.ts?vl-live');
  const body = [
    JSON.stringify({ _time: '2026-07-10T10:00:00Z', _msg: 'hi', _stream: '{s="x"}' }),
    JSON.stringify({ _time: '2026-07-10T11:00:00Z', _msg: 'bye' }),
  ].join('\n');
  const { fn, calls } = fakeFetch({ body });
  const r = await mod.safeSearchLogs('error', 50, fn);
  assert.equal(r.configured, true);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].message, 'bye'); // newest first
  assert.ok(calls[0].includes('query=error'));
});

test('victoria-logs: non-2xx → error note, empty rows, no throw', async () => {
  process.env.OFFGRID_VICTORIALOGS_URL = 'http://vl.test';
  const mod = await import('../src/lib/victoria-logs.ts?vl-500');
  const { fn } = fakeFetch({ status: 500, body: 'boom' });
  const r = await mod.safeSearchLogs('*', 10, fn);
  assert.equal(r.configured, true);
  assert.deepEqual(r.rows, []);
  assert.match(r.error ?? '', /VictoriaLogs 500/);
});

test('victoria-logs: transport failure surfaces the cause code', async () => {
  process.env.OFFGRID_VICTORIALOGS_URL = 'http://vl.test';
  const mod = await import('../src/lib/victoria-logs.ts?vl-econn');
  const { fn } = fakeFetch({ throwCode: 'ECONNREFUSED' });
  const r = await mod.safeSearchLogs('*', 10, fn);
  assert.match(r.error ?? '', /ECONNREFUSED/);
});

// ── Jaeger ─────────────────────────────────────────────────────────────────────
test('jaeger: unconfigured → configured:false, empty services/traces', async () => {
  delete process.env.OFFGRID_JAEGER_URL;
  delete process.env.OFFGRID_JAEGER_WEB_URL;
  const mod = await import('../src/lib/jaeger.ts?jg-unset');
  assert.equal(mod.jaegerConfigured(), false);
  const r = await mod.safeJaegerOverview();
  assert.equal(r.configured, false);
  assert.deepEqual(r.services, []);
  assert.deepEqual(r.traces, []);
  assert.equal(r.webUrl, null);
});

test('jaeger: configured → services then recent traces for the default service', async () => {
  process.env.OFFGRID_JAEGER_URL = 'http://jaeger.test';
  const mod = await import('../src/lib/jaeger.ts?jg-live');
  // First call = /api/services, second = /api/traces. Return different bodies by URL.
  const fn = (async (url: string) => {
    const u = String(url);
    const json = u.includes('/api/services')
      ? { data: ['chat', 'gateway'] }
      : {
          data: [
            {
              traceID: 't1',
              processes: { p: { serviceName: 'chat' } },
              spans: [
                { spanID: 's', operationName: 'op', startTime: 0, duration: 1000, processID: 'p' },
              ],
            },
          ],
        };
    return {
      ok: true,
      status: 200,
      json: async () => json,
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const r = await mod.safeJaegerOverview(undefined, 10, fn);
  assert.equal(r.configured, true);
  assert.deepEqual(r.services, ['chat', 'gateway']);
  assert.equal(r.selectedService, 'chat');
  assert.equal(r.traces.length, 1);
  assert.equal(r.traces[0].rootOperation, 'op');
});

test('jaeger: web URL only set when OFFGRID_JAEGER_WEB_URL present', async () => {
  process.env.OFFGRID_JAEGER_URL = 'http://jaeger.test';
  process.env.OFFGRID_JAEGER_WEB_URL = 'http://ui.test';
  const mod = await import('../src/lib/jaeger.ts?jg-web');
  assert.equal(mod.jaegerTraceUrl('abc'), 'http://ui.test/trace/abc');
  assert.equal(mod.jaegerTraceUrl(), 'http://ui.test/search');
});

test('jaeger: error on services call → configured:true + error, no throw', async () => {
  process.env.OFFGRID_JAEGER_URL = 'http://jaeger.test';
  delete process.env.OFFGRID_JAEGER_WEB_URL;
  const mod = await import('../src/lib/jaeger.ts?jg-err');
  const { fn } = fakeFetch({ status: 503 });
  const r = await mod.safeJaegerOverview(undefined, 10, fn);
  assert.equal(r.configured, true);
  assert.match(r.error ?? '', /Jaeger 503/);
});

test('jaeger: safeTraceDetail shapes one trace to spans', async () => {
  process.env.OFFGRID_JAEGER_URL = 'http://jaeger.test';
  const mod = await import('../src/lib/jaeger.ts?jg-detail');
  const { fn } = fakeFetch({
    json: {
      data: [
        {
          traceID: 't1',
          processes: { p: { serviceName: 'gw' } },
          spans: [
            { spanID: 'r', operationName: 'root', startTime: 0, duration: 1000, processID: 'p' },
          ],
        },
      ],
    },
  });
  const r = await mod.safeTraceDetail('t1', fn);
  assert.equal(r.configured, true);
  assert.equal(r.spans.length, 1);
  assert.equal(r.spans[0].operation, 'root');
});
