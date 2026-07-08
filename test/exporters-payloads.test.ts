import assert from 'node:assert/strict';
import { test } from 'node:test';

// PURE unit tests for the M6 exporter payload builders + config validation. Zero I/O — every builder
// is exercised directly against expected bytes/shapes. Also drives export()/test() with a FAKE fetch
// so the network contract is verified without a real Splunk/OpenLineage/OTLP endpoint.

// ── config validation ──────────────────────────────────────────────────────────────────────────
test('validateExportTarget — kind, endpoint, secretRef rules', async () => {
  const { validateExportTarget, validateSecretRef, validateEndpoint, isRunnable } = await import(
    '@/lib/exporters/config'
  );

  // bad kind
  assert.equal(validateExportTarget({ kind: 'nope' }).ok, false);

  // audit requires endpoint + secret
  const missingBoth = validateExportTarget({ kind: 'audit' });
  assert.equal(missingBoth.ok, false);
  assert.ok(missingBoth.errors.some((e) => /endpoint/i.test(e)));
  assert.ok(missingBoth.errors.some((e) => /secret/i.test(e)));

  const okAudit = validateExportTarget({
    kind: 'audit',
    endpoint: 'https://splunk.example.com:8088',
    secretRef: 'splunk/hec-token',
  });
  assert.equal(okAudit.ok, true);
  assert.deepEqual(okAudit.value, {
    kind: 'audit',
    endpoint: 'https://splunk.example.com:8088',
    enabled: true,
    secretRef: 'splunk/hec-token',
  });

  // lineage: endpoint required, secret optional
  assert.equal(
    validateExportTarget({ kind: 'lineage', endpoint: 'https://marquez/api/v1/lineage' }).ok,
    true,
  );
  assert.equal(validateExportTarget({ kind: 'lineage' }).ok, false);

  // metrics: endpoint + secret both optional (scrape mode)
  const scrape = validateExportTarget({ kind: 'metrics' });
  assert.equal(scrape.ok, true);
  assert.equal(scrape.value!.endpoint, '');

  // endpoint must be http(s)
  assert.equal(validateEndpoint('ftp://x', true).ok, false);
  assert.equal(validateEndpoint('not a url', true).ok, false);
  assert.equal(validateEndpoint('', false).ok, true);

  // secretRef must be a valid vault key path, never smuggle traversal
  assert.equal(validateSecretRef('a/b/c').ok, true);
  assert.equal(validateSecretRef('../etc/passwd').ok, false);
  assert.equal(validateSecretRef('/leading').ok, false);
  assert.equal(validateSecretRef('has space').ok, false);
  assert.equal(validateSecretRef(null).ref, null);

  // isRunnable preconditions
  assert.equal(
    isRunnable({ kind: 'audit', endpoint: 'https://x', enabled: true, secretRef: 'k' }),
    true,
  );
  assert.equal(
    isRunnable({ kind: 'audit', endpoint: 'https://x', enabled: true, secretRef: null }),
    false,
    'audit needs a secret',
  );
  assert.equal(
    isRunnable({ kind: 'audit', endpoint: 'https://x', enabled: false, secretRef: 'k' }),
    false,
    'disabled is not runnable',
  );
  assert.equal(
    isRunnable({ kind: 'metrics', endpoint: null, enabled: true, secretRef: null }),
    true,
    'metrics scrape is runnable with no endpoint/secret',
  );
});

test('scrapeAuthorized — closed by default, matches scrape or admin token', async () => {
  const { scrapeAuthorized } = await import('@/lib/exporters/config');
  assert.equal(scrapeAuthorized('', {}), false, 'no token presented');
  assert.equal(scrapeAuthorized('x', {}), false, 'nothing configured ⇒ closed');
  assert.equal(scrapeAuthorized('s3cr3t', { scrapeToken: 's3cr3t' }), true);
  assert.equal(scrapeAuthorized('admin', { adminToken: 'admin' }), true);
  assert.equal(scrapeAuthorized('wrong', { scrapeToken: 's3cr3t' }), false);
});

// ── Splunk HEC ───────────────────────────────────────────────────────────────────────────────
test('Splunk HEC — url, auth header, event + body shape', async () => {
  const { hecUrl, hecAuthHeader, buildHecEvent, buildHecBody, hecTime } = await import(
    '@/lib/exporters/splunk-hec'
  );
  assert.equal(hecUrl('https://s:8088'), 'https://s:8088/services/collector/event');
  assert.equal(hecUrl('https://s:8088/'), 'https://s:8088/services/collector/event');
  assert.equal(
    hecUrl('https://s:8088/services/collector'),
    'https://s:8088/services/collector/event',
  );
  assert.equal(
    hecUrl('https://s:8088/services/collector/event'),
    'https://s:8088/services/collector/event',
  );

  assert.deepEqual(hecAuthHeader('tok'), {
    'Content-Type': 'application/json',
    Authorization: 'Splunk tok',
  });
  assert.deepEqual(hecAuthHeader(null), { 'Content-Type': 'application/json' });

  const ev = {
    ts: '2026-07-08T10:00:00.000Z',
    actor: { type: 'user' as const, id: 'a@b.co', label: 'A' },
    org: 'default',
    action: 'chat.send',
    outcome: 'ok' as const,
    model: 'gemma-local',
  };
  const hec = buildHecEvent(ev);
  assert.equal(hec.time, hecTime('2026-07-08T10:00:00.000Z'));
  assert.equal(hec.sourcetype, 'offgrid:audit');
  assert.deepEqual(hec.event, ev);

  const body = buildHecBody([ev, ev]);
  const lines = body.split('\n');
  assert.equal(lines.length, 2, 'newline-delimited, no array wrapper');
  assert.deepEqual(JSON.parse(lines[0]).event, ev);
});

test('Splunk HEC — export()/test() with a fake fetch (no real Splunk)', async () => {
  const { splunkHecExporter } = await import('@/lib/exporters/splunk-hec');
  const target = { id: 't', kind: 'audit' as const, endpoint: 'https://s:8088', secret: 'tok' };
  const ev = {
    ts: '2026-07-08T10:00:00.000Z',
    actor: { type: 'user' as const, id: 'a', label: 'a' },
    org: 'default',
    action: 'chat.send',
    outcome: 'ok' as const,
  };

  // success: 200 → ok, count = records
  const calls: { url: string; body?: string; headers?: Record<string, string> }[] = [];
  const okFetch = async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    calls.push({ url, body: init?.body, headers: init?.headers });
    return { ok: true, status: 200, text: async () => '{"text":"Success","code":0}' };
  };
  const good = await splunkHecExporter.export(target, [ev], okFetch);
  assert.equal(good.ok, true);
  assert.equal(good.count, 1);
  assert.equal(calls[0].url, 'https://s:8088/services/collector/event');
  assert.equal(calls[0].headers!.Authorization, 'Splunk tok');
  assert.deepEqual(JSON.parse(calls[0].body!).event, ev);

  // auth failure: 403 → fail
  const badFetch = async () => ({ ok: false, status: 403, text: async () => 'Invalid token' });
  const bad = await splunkHecExporter.export(target, [ev], badFetch);
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /403/);

  // test(): 400 "No data" ⇒ token accepted / reachable
  const noData = async () => ({ ok: false, status: 400, text: async () => '{"text":"No data","code":5}' });
  const probe = await splunkHecExporter.test(target, noData);
  assert.equal(probe.ok, true);

  // test(): 401 ⇒ token rejected
  const unauth = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  assert.equal((await splunkHecExporter.test(target, unauth)).ok, false);

  // empty batch is a no-op success
  assert.deepEqual(await splunkHecExporter.export(target, [], okFetch), {
    ok: true,
    count: 0,
    detail: 'Nothing to export.',
  });
});

// ── OpenLineage ────────────────────────────────────────────────────────────────────────────────
test('OpenLineage — url + spec-compliant RunEvent shape', async () => {
  const { openLineageUrl, buildRunEvent, openLineageHeaders } = await import(
    '@/lib/exporters/openlineage'
  );
  assert.equal(openLineageUrl('https://marquez'), 'https://marquez/api/v1/lineage');
  assert.equal(openLineageUrl('https://x/api/v1/lineage'), 'https://x/api/v1/lineage');

  assert.deepEqual(openLineageHeaders('k'), {
    'Content-Type': 'application/json',
    Authorization: 'Bearer k',
  });
  assert.deepEqual(openLineageHeaders(null), { 'Content-Type': 'application/json' });

  const ev = buildRunEvent({
    job: 'ingest.corebank',
    run: 'run-1',
    status: 'COMPLETE',
    namespace: 'ns',
    eventTime: '2026-07-08T10:00:00.000Z',
    inputs: ['src'],
    outputs: ['dst'],
  });
  assert.equal(ev.eventType, 'COMPLETE');
  assert.equal(ev.eventTime, '2026-07-08T10:00:00.000Z');
  assert.deepEqual(ev.run, { runId: 'run-1' });
  assert.deepEqual(ev.job, { namespace: 'ns', name: 'ingest.corebank' });
  assert.deepEqual(ev.inputs, [{ namespace: 'ns', name: 'src' }]);
  assert.deepEqual(ev.outputs, [{ namespace: 'ns', name: 'dst' }]);
  assert.ok(typeof ev.producer === 'string');

  // FAIL status normalizes to FAIL
  assert.equal(buildRunEvent({ job: 'j', run: 'r', status: 'FAIL' }).eventType, 'FAIL');
});

test('OpenLineage — export() posts one event per record via fake fetch', async () => {
  const { openLineageExporter } = await import('@/lib/exporters/openlineage');
  const target = { id: 't', kind: 'lineage' as const, endpoint: 'https://marquez', secret: null };
  const recs = [
    { job: 'a', run: '1', status: 'COMPLETE' as const },
    { job: 'b', run: '2', status: 'COMPLETE' as const },
  ];
  let posts = 0;
  const okFetch = async (url: string) => {
    posts += 1;
    assert.equal(url, 'https://marquez/api/v1/lineage');
    return { ok: true, status: 201, text: async () => '' };
  };
  const r = await openLineageExporter.export(target, recs, okFetch);
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(posts, 2, 'one POST per event');

  // failure on 2nd event surfaces which failed
  let n = 0;
  const flaky = async () => {
    n += 1;
    return n === 1
      ? { ok: true, status: 200, text: async () => '' }
      : { ok: false, status: 500, text: async () => 'boom' };
  };
  const bad = await openLineageExporter.export(target, recs, flaky);
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /2\/2/);
});

// ── Prometheus / OTLP ─────────────────────────────────────────────────────────────────────────
test('Prometheus text-exposition rendering', async () => {
  const { renderPromText, escapeLabelValue, sanitizeName } = await import(
    '@/lib/exporters/prometheus'
  );
  assert.equal(sanitizeName('offgrid.cost usd'), 'offgrid_cost_usd');
  assert.equal(sanitizeName('9lives'), '_9lives');
  assert.equal(escapeLabelValue('a"b\\c\nd'), 'a\\"b\\\\c\\nd');

  const text = renderPromText([
    { name: 'offgrid_requests_total', help: 'reqs', type: 'counter', value: 10 },
    {
      name: 'offgrid_model_cost_usd',
      help: 'cost by model',
      type: 'gauge',
      value: 1.5,
      labels: { model: 'gpt-4o' },
    },
    {
      name: 'offgrid_model_cost_usd',
      help: 'cost by model',
      type: 'gauge',
      value: 0,
      labels: { model: 'gemma-local' },
    },
  ]);
  const lines = text.trim().split('\n');
  assert.ok(lines.includes('# HELP offgrid_requests_total reqs'));
  assert.ok(lines.includes('# TYPE offgrid_requests_total counter'));
  assert.ok(lines.includes('offgrid_requests_total 10'));
  // HELP/TYPE emitted once per metric name, then one line per labelset
  assert.equal(lines.filter((l) => l === '# TYPE offgrid_model_cost_usd gauge').length, 1);
  assert.ok(lines.includes('offgrid_model_cost_usd{model="gpt-4o"} 1.5'));
  assert.ok(lines.includes('offgrid_model_cost_usd{model="gemma-local"} 0'));

  // non-finite values dropped
  const nan = renderPromText([{ name: 'x', help: 'h', type: 'gauge', value: NaN }]);
  assert.equal(nan.includes('\nx'), false);
});

test('OTLP payload + push via fake fetch', async () => {
  const { buildOtlpPayload, otlpUrl, prometheusExporter } = await import('@/lib/exporters/prometheus');
  assert.equal(otlpUrl('https://col'), 'https://col/v1/metrics');
  assert.equal(otlpUrl('https://col/v1/metrics'), 'https://col/v1/metrics');

  const payload = buildOtlpPayload(
    [
      { name: 'offgrid_requests_total', help: 'r', type: 'counter', value: 5 },
      { name: 'offgrid_cost_usd', help: 'c', type: 'gauge', value: 2.5, labels: { org: 'x' } },
    ],
    1_000,
  );
  const metrics = (payload as any).resourceMetrics[0].scopeMetrics[0].metrics;
  assert.equal(metrics.length, 2);
  assert.ok(metrics[0].sum, 'counter → sum');
  assert.equal(metrics[0].sum.isMonotonic, true);
  assert.ok(metrics[1].gauge, 'gauge → gauge');
  assert.equal(metrics[1].gauge.dataPoints[0].asDouble, 2.5);
  assert.deepEqual(metrics[1].gauge.dataPoints[0].attributes[0], {
    key: 'org',
    value: { stringValue: 'x' },
  });

  // scrape mode (no endpoint): test()/export() are no-network no-ops that report scrape mode
  const scrape = { id: 't', kind: 'metrics' as const, endpoint: '', secret: null };
  const never = async () => {
    throw new Error('should not fetch in scrape mode');
  };
  assert.equal((await prometheusExporter.test(scrape, never)).ok, true);
  assert.equal((await prometheusExporter.export(scrape, [], never)).ok, true);

  // push mode: posts OTLP to the collector
  const push = { id: 't', kind: 'metrics' as const, endpoint: 'https://col', secret: 'k' };
  let pushed = false;
  const okFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    pushed = true;
    assert.equal(url, 'https://col/v1/metrics');
    assert.equal(init!.headers!.Authorization, 'Bearer k');
    return { ok: true, status: 200, text: async () => '' };
  };
  const r = await prometheusExporter.export(
    push,
    [{ name: 'x', help: 'h', type: 'gauge', value: 1 }],
    okFetch,
  );
  assert.equal(r.ok, true);
  assert.equal(pushed, true);
});

// ── registry: finops → samples ─────────────────────────────────────────────────────────────────
test('finOpsToSamples maps rollup to metric samples', async () => {
  const { finOpsToSamples, exporterFor } = await import('@/lib/exporters/registry');
  const samples = finOpsToSamples({
    totals: { requests: 12, tokens: 3400, costUsd: 0.42, localShare: 75 },
    byModel: [{ label: 'gpt-4o', requests: 3, tokens: 100, costUsd: 0.42 }],
    bySubject: [],
    byKey: [],
    daily: [],
  } as any);
  const byName = Object.fromEntries(samples.map((s) => [s.name + JSON.stringify(s.labels ?? {}), s.value]));
  assert.equal(byName['offgrid_requests_total{}'], 12);
  assert.equal(byName['offgrid_cost_usd{}'], 0.42);
  assert.equal(byName['offgrid_local_share_percent{}'], 75);
  assert.equal(byName['offgrid_model_cost_usd{"model":"gpt-4o"}'], 0.42);

  // registry maps kind → the right exporter
  assert.equal(exporterFor('audit').id, 'splunk-hec');
  assert.equal(exporterFor('lineage').id, 'openlineage');
  assert.equal(exporterFor('metrics').id, 'prometheus-otlp');
});
