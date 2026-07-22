import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDuration,
  normalizeJobList,
  normalizeJobRef,
  normalizeNamespaceList,
  normalizeNamespaceOwnership,
  normalizeRun,
  normalizeRunHistory,
  normalizeTag,
  normalizeTagList,
  summarizeRuns,
  validateOwnerInput,
  validateRunQuery,
  validateTagDecl,
} from '../src/lib/marquez-lineage.ts';
import { createMarquezLineageReader } from '../src/lib/adapters/marquez-lineage.ts';

// ── PURE: formatDuration ─────────────────────────────────────────────────────────────────────
test('formatDuration renders across magnitudes and rejects bad input', () => {
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(undefined), '—');
  assert.equal(formatDuration(Number.NaN), '—');
  assert.equal(formatDuration(-5), '—');
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(420), '420ms');
  assert.equal(formatDuration(999), '999ms');
  assert.equal(formatDuration(1000), '1.0s');
  assert.equal(formatDuration(3200), '3.2s');
  assert.equal(formatDuration(59_999), '60.0s');
  assert.equal(formatDuration(64_000), '1m 04s');
  assert.equal(formatDuration(125_000), '2m 05s');
  assert.equal(formatDuration(3_600_000), '1h 00m');
  assert.equal(formatDuration(3_720_000), '1h 02m');
});

// ── PURE: normalizeRun ───────────────────────────────────────────────────────────────────────
test('normalizeRun uses Marquez durationMs when present', () => {
  const row = normalizeRun({
    id: 'r1',
    state: 'COMPLETED',
    startedAt: '2026-07-01T10:00:00Z',
    endedAt: '2026-07-01T10:00:05Z',
    durationMs: 4200,
  });
  assert.equal(row.durationMs, 4200);
  assert.equal(row.durationDerived, false);
  assert.equal(row.state, 'COMPLETED');
});

test('normalizeRun derives duration from bounds when Marquez left it null', () => {
  const row = normalizeRun({
    id: 'r2',
    state: 'completed',
    startedAt: '2026-07-01T10:00:00Z',
    endedAt: '2026-07-01T10:00:05Z',
    durationMs: null,
  });
  assert.equal(row.durationMs, 5000);
  assert.equal(row.durationDerived, true);
});

test('normalizeRun leaves duration null when only endedAt is present (terminal-only emit)', () => {
  const row = normalizeRun({ id: 'r3', state: 'COMPLETED', endedAt: '2026-07-01T10:00:05Z' });
  assert.equal(row.durationMs, null);
  assert.equal(row.durationDerived, false);
  assert.equal(row.startedAt, null);
  assert.equal(row.endedAt, '2026-07-01T10:00:05Z');
});

test('normalizeRun ignores a negative/unparseable span', () => {
  const neg = normalizeRun({
    id: 'r4',
    startedAt: '2026-07-01T10:00:05Z',
    endedAt: '2026-07-01T10:00:00Z',
  });
  assert.equal(neg.durationMs, null);
  const bad = normalizeRun({ id: 'r5', startedAt: 'not-a-date', endedAt: '2026-07-01T10:00:00Z' });
  assert.equal(bad.durationMs, null);
});

test('normalizeRun lifts nominalTime from the facet and top-level, computes nominal duration', () => {
  const fromFacet = normalizeRun({
    id: 'r6',
    state: 'COMPLETED',
    facets: {
      nominalTime: {
        nominalStartTime: '2026-07-01T00:00:00Z',
        nominalEndTime: '2026-07-01T01:00:00Z',
      },
    },
  });
  assert.equal(fromFacet.nominalStartTime, '2026-07-01T00:00:00Z');
  assert.equal(fromFacet.nominalEndTime, '2026-07-01T01:00:00Z');
  assert.equal(fromFacet.nominalDurationMs, 3_600_000);
  assert.equal(fromFacet.hasNominalTime, true);
  assert.deepEqual(fromFacet.facetNames, ['nominalTime']);

  const topLevel = normalizeRun({
    id: 'r7',
    nominalStartTime: '2026-07-02T00:00:00Z',
    nominalEndTime: '2026-07-02T00:30:00Z',
  });
  assert.equal(topLevel.nominalStartTime, '2026-07-02T00:00:00Z');
  assert.equal(topLevel.nominalDurationMs, 1_800_000);
});

test('normalizeRun reads input/output dataset names and defends bad shapes', () => {
  const row = normalizeRun({
    id: 'r8',
    inputDatasetVersions: [
      { datasetVersionId: { namespace: 'ns', name: 'corebank.customers' } },
      { name: 'fallback.name' },
      { datasetVersionId: null },
      // @ts-expect-error deliberately malformed
      null,
    ],
    outputDatasetVersions: [{ datasetVersionId: { name: 'answer.grounded' } }],
  });
  assert.deepEqual(row.inputs, ['corebank.customers', 'fallback.name']);
  assert.deepEqual(row.outputs, ['answer.grounded']);
});

test('normalizeRun defends null/garbage input', () => {
  const a = normalizeRun(null);
  assert.equal(a.id, '(unknown)');
  assert.equal(a.state, 'UNKNOWN');
  assert.deepEqual(a.inputs, []);
  assert.deepEqual(a.facetNames, []);
  // @ts-expect-error non-object
  const b = normalizeRun(42);
  assert.equal(b.id, '(unknown)');
});

test('normalizeRun maps every known state, incl. FAIL alias, and unknowns', () => {
  assert.equal(normalizeRun({ state: 'FAIL' }).state, 'FAILED');
  assert.equal(normalizeRun({ state: 'FAILED' }).state, 'FAILED');
  assert.equal(normalizeRun({ state: 'RUNNING' }).state, 'RUNNING');
  assert.equal(normalizeRun({ state: 'ABORTED' }).state, 'ABORTED');
  assert.equal(normalizeRun({ state: 'NEW' }).state, 'NEW');
  assert.equal(normalizeRun({ state: 'WEIRD' }).state, 'UNKNOWN');
  assert.equal(normalizeRun({}).state, 'UNKNOWN');
});

// ── PURE: summarizeRuns ──────────────────────────────────────────────────────────────────────
test('summarizeRuns tallies states, success rate, avg + total duration, last run', () => {
  const rows = [
    normalizeRun({ id: 'a', state: 'COMPLETED', durationMs: 1000, endedAt: '2026-07-01T10:00:00Z' }),
    normalizeRun({ id: 'b', state: 'COMPLETED', durationMs: 3000, endedAt: '2026-07-03T10:00:00Z' }),
    normalizeRun({ id: 'c', state: 'FAILED', durationMs: 2000, endedAt: '2026-07-02T10:00:00Z' }),
    normalizeRun({ id: 'd', state: 'RUNNING', startedAt: '2026-07-04T10:00:00Z' }),
    normalizeRun({ id: 'e', state: 'ABORTED', createdAt: '2026-06-30T10:00:00Z' }),
  ];
  const s = summarizeRuns(rows);
  assert.equal(s.total, 5);
  assert.equal(s.completed, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.running, 1);
  assert.equal(s.other, 1);
  assert.equal(s.successRate, 2 / 3);
  assert.equal(s.totalDurationMs, 6000);
  assert.equal(s.avgDurationMs, 2000);
  assert.equal(s.lastRunAt, '2026-07-04T10:00:00Z');
});

test('summarizeRuns handles empty + no-duration + no-decided-runs', () => {
  const empty = summarizeRuns([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.successRate, null);
  assert.equal(empty.avgDurationMs, null);
  assert.equal(empty.lastRunAt, null);
  assert.equal(empty.totalDurationMs, 0);

  const onlyRunning = summarizeRuns([normalizeRun({ id: 'x', state: 'RUNNING' })]);
  assert.equal(onlyRunning.successRate, null);
  assert.equal(onlyRunning.avgDurationMs, null);
});

// ── PURE: normalizeRunHistory ────────────────────────────────────────────────────────────────
test('normalizeRunHistory sorts most-recent-first and labels the job', () => {
  const view = normalizeRunHistory({
    namespace: 'offgrid-console',
    job: 'agent:sop-synth',
    runs: [
      { id: 'old', state: 'COMPLETED', endedAt: '2026-07-01T10:00:00Z' },
      { id: 'new', state: 'COMPLETED', endedAt: '2026-07-05T10:00:00Z' },
      { id: 'mid', state: 'FAILED', endedAt: '2026-07-03T10:00:00Z' },
    ],
  });
  assert.deepEqual(
    view.runs.map((r) => r.id),
    ['new', 'mid', 'old'],
  );
  assert.equal(view.job, 'agent:sop-synth');
  assert.equal(view.jobLabel, 'agent:sop-synth');
  assert.equal(view.summary.total, 3);
});

test('normalizeRunHistory tolerates null/absent runs', () => {
  const v = normalizeRunHistory({ namespace: 'ns', job: 'j', runs: null });
  assert.deepEqual(v.runs, []);
  assert.equal(v.summary.total, 0);
  const mixed = normalizeRunHistory({
    namespace: 'ns',
    job: 'j',
    runs: [
      { id: 'p', endedAt: '2026-07-01T10:00:00Z' },
      { id: 'q', endedAt: '2026-07-01T10:00:00Z' }, // equal timestamp → comparator returns 0
      { id: 'no-ts', state: 'NEW' }, // no instant at all → sinks to bottom via the '' fallback
    ],
  });
  assert.equal(mixed.runs.length, 3);
  assert.equal(mixed.runs[2].id, 'no-ts');
});

// ── PURE: jobs ───────────────────────────────────────────────────────────────────────────────
test('normalizeJobRef reads latestRun state + timing and labels opaque ids', () => {
  const j = normalizeJobRef({
    name: 'brain.ingest',
    type: 'BATCH',
    latestRun: { state: 'COMPLETED', endedAt: '2026-07-01T10:00:00Z' },
  });
  assert.equal(j.name, 'brain.ingest');
  assert.equal(j.lastRunState, 'COMPLETED');
  assert.equal(j.lastRunAt, '2026-07-01T10:00:00Z');
  assert.equal(j.type, 'BATCH');

  const noRun = normalizeJobRef({ name: 'retrieval.route', updatedAt: '2026-07-02T10:00:00Z' });
  assert.equal(noRun.lastRunState, 'UNKNOWN');
  assert.equal(noRun.lastRunAt, '2026-07-02T10:00:00Z');

  const unnamed = normalizeJobRef(null);
  assert.equal(unnamed.name, '(unnamed)');
});

test('normalizeJobList maps + defends', () => {
  assert.deepEqual(normalizeJobList(null), []);
  const list = normalizeJobList([{ name: 'a' }, { name: 'b' }]);
  assert.equal(list.length, 2);
});

// ── PURE: namespaces + tags ────────────────────────────────────────────────────────────────
test('normalizeNamespaceOwnership reads owner/description/hidden, drops nameless', () => {
  const n = normalizeNamespaceOwnership({
    name: 'offgrid-console',
    ownerName: 'data-governance',
    description: 'console namespace',
    createdAt: '2026-07-01T00:00:00Z',
    isHidden: true,
  });
  assert.equal(n?.ownerName, 'data-governance');
  assert.equal(n?.description, 'console namespace');
  assert.equal(n?.isHidden, true);
  assert.equal(normalizeNamespaceOwnership({ ownerName: 'x' }), null);
  assert.equal(normalizeNamespaceOwnership(null), null);
  const anon = normalizeNamespaceOwnership({ name: 'default', ownerName: 'anonymous' });
  assert.equal(anon?.isHidden, false);
});

test('normalizeNamespaceList filters out invalid entries', () => {
  const list = normalizeNamespaceList([{ name: 'a' }, { ownerName: 'nope' }, null]);
  assert.equal(list.length, 1);
  assert.deepEqual(normalizeNamespaceList(null), []);
});

test('normalizeTag + normalizeTagList', () => {
  assert.deepEqual(normalizeTag({ name: 'PII', description: 'sensitive' }), {
    name: 'PII',
    description: 'sensitive',
  });
  assert.equal(normalizeTag({ description: 'no name' }), null);
  assert.equal(normalizeTag(null), null);
  const list = normalizeTagList([{ name: 'PII' }, { name: '' }, null]);
  assert.equal(list.length, 1);
  assert.equal(list[0].description, null);
  assert.deepEqual(normalizeTagList(undefined), []);
});

// ── PURE: validators ─────────────────────────────────────────────────────────────────────────
test('validateOwnerInput requires name + owner, trims, keeps optional description', () => {
  assert.deepEqual(validateOwnerInput({ name: '  ns ', ownerName: ' team ' }), {
    ok: true,
    value: { name: 'ns', ownerName: 'team' },
  });
  assert.deepEqual(validateOwnerInput({ name: 'ns', ownerName: 'team', description: 'd' }), {
    ok: true,
    value: { name: 'ns', ownerName: 'team', description: 'd' },
  });
  assert.equal(validateOwnerInput({ ownerName: 'team' }).ok, false);
  assert.equal(validateOwnerInput({ name: 'ns' }).ok, false);
  assert.equal(validateOwnerInput({ name: '  ', ownerName: 'x' }).error, 'namespace name required');
  assert.equal(validateOwnerInput({ name: 'ns', ownerName: '' }).error, 'ownerName required');
});

test('validateTagDecl requires a name', () => {
  assert.deepEqual(validateTagDecl({ name: 'PII' }), { ok: true, value: { name: 'PII' } });
  assert.deepEqual(validateTagDecl({ name: 'PII', description: 'x' }), {
    ok: true,
    value: { name: 'PII', description: 'x' },
  });
  assert.equal(validateTagDecl({}).ok, false);
});

test('validateRunQuery requires namespace + job', () => {
  assert.deepEqual(validateRunQuery({ namespace: 'ns', job: 'j' }), {
    ok: true,
    value: { namespace: 'ns', job: 'j' },
  });
  assert.equal(validateRunQuery({ job: 'j' }).error, 'namespace required');
  assert.equal(validateRunQuery({ namespace: 'ns' }).error, 'job required');
});

// ── ADAPTER: fake fetch at the network boundary (no live Marquez, no mocks of our own code) ──
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function recordingFetcher(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    return handler(u, init);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

test('adapter.configured reflects baseUrl / env', () => {
  assert.equal(createMarquezLineageReader({ baseUrl: 'http://mq:9000' }).configured(), true);
  assert.equal(createMarquezLineageReader({ baseUrl: '' }).configured(), false);
});

test('adapter reads return not-configured envelopes when no baseUrl', async () => {
  const orig = process.env.OFFGRID_MARQUEZ_URL;
  delete process.env.OFFGRID_MARQUEZ_URL;
  try {
    const r = createMarquezLineageReader({});
    const ns = await r.listNamespaces();
    assert.equal(ns.configured, false);
    assert.deepEqual(ns.data, []);
    const runs = await r.readRunHistory('ns', 'j');
    assert.equal(runs.configured, false);
    assert.equal(runs.data, null);
    const w = await r.setNamespaceOwner({ name: 'ns', ownerName: 'o' });
    assert.equal(w.ok, false);
    assert.equal(w.error, 'Marquez not configured');
  } finally {
    if (orig !== undefined) process.env.OFFGRID_MARQUEZ_URL = orig;
  }
});

test('adapter.listNamespaces normalizes and strips trailing slash on baseUrl', async () => {
  const { fetcher, calls } = recordingFetcher(() =>
    jsonResponse({ namespaces: [{ name: 'default', ownerName: 'anonymous' }, { ownerName: 'x' }] }),
  );
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000/', fetcher });
  const res = await r.listNamespaces();
  assert.equal(res.configured, true);
  assert.equal(res.error, null);
  assert.equal(res.data.length, 1);
  assert.equal(res.data[0].name, 'default');
  assert.equal(calls[0].url, 'http://mq:9000/api/v1/namespaces');
});

test('adapter.listJobs encodes namespace + passes limit', async () => {
  const { fetcher, calls } = recordingFetcher(() =>
    jsonResponse({ jobs: [{ name: 'brain.ingest', latestRun: { state: 'COMPLETED' } }] }),
  );
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.listJobs('offgrid console', 25);
  assert.equal(res.data.length, 1);
  assert.equal(calls[0].url, 'http://mq:9000/api/v1/namespaces/offgrid%20console/jobs?limit=25');
});

test('adapter.readRunHistory returns a normalized view with encoded job path', async () => {
  const { fetcher, calls } = recordingFetcher(() =>
    jsonResponse({
      runs: [
        { id: 'a', state: 'COMPLETED', endedAt: '2026-07-01T10:00:00Z' },
        { id: 'b', state: 'FAILED', endedAt: '2026-07-02T10:00:00Z' },
      ],
    }),
  );
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.readRunHistory('offgrid-console', 'agent:sop-synth');
  assert.equal(res.configured, true);
  assert.equal(res.data?.runs.length, 2);
  assert.equal(res.data?.runs[0].id, 'b'); // most-recent first
  assert.equal(res.data?.summary.failed, 1);
  assert.equal(
    calls[0].url,
    'http://mq:9000/api/v1/namespaces/offgrid-console/jobs/agent%3Asop-synth/runs?limit=50',
  );
});

test('adapter.readRunHistory surfaces a non-ok status as an error envelope (data null)', async () => {
  const { fetcher } = recordingFetcher(() => jsonResponse({}, false, 500));
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.readRunHistory('ns', 'j');
  assert.equal(res.configured, true);
  assert.equal(res.data, null);
  assert.equal(res.error, 'Marquez 500');
});

test('adapter.readRunHistory surfaces a thrown fetch as an error envelope', async () => {
  const fetcher = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.readRunHistory('ns', 'j');
  assert.equal(res.error, 'network down');
  assert.equal(res.data, null);
});

test('adapter.listTags normalizes tag descriptions', async () => {
  const { fetcher } = recordingFetcher(() =>
    jsonResponse({ tags: [{ name: 'PII', description: 'sensitive' }, { name: 'GOVERNED' }] }),
  );
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.listTags();
  assert.equal(res.data.length, 2);
  assert.equal(res.data[0].description, 'sensitive');
});

test('adapter.listJobs surfaces a non-ok read', async () => {
  const { fetcher } = recordingFetcher(() => jsonResponse({}, false, 404));
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.listJobs('ns');
  assert.equal(res.error, 'Marquez 404');
  assert.deepEqual(res.data, []);
});

// ── ADAPTER: writes delegate to the pure builders, send PUT/POST/DELETE ──────────────────────
test('adapter.setNamespaceOwner PUTs the namespace with ownerName', async () => {
  const { fetcher, calls } = recordingFetcher(() => jsonResponse({ ok: true }));
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.setNamespaceOwner({ name: 'offgrid-console', ownerName: 'data-gov' });
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'http://mq:9000/api/v1/namespaces/offgrid-console');
  assert.equal(calls[0].init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { ownerName: 'data-gov' });
});

test('adapter.setNamespaceOwner returns a 400 when the builder rejects empty name', async () => {
  const { fetcher, calls } = recordingFetcher(() => jsonResponse({ ok: true }));
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.setNamespaceOwner({ name: '', ownerName: 'x' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0); // never reached the network
});

test('adapter.declareTag PUTs the tag', async () => {
  const { fetcher, calls } = recordingFetcher(() => jsonResponse({ ok: true }));
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.declareTag({ name: 'GOVERNED', description: 'reviewed' });
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'http://mq:9000/api/v1/tags/GOVERNED');
  assert.equal(calls[0].init?.method, 'PUT');
});

test('adapter.tagDataset POSTs and untagDataset DELETEs', async () => {
  const { fetcher, calls } = recordingFetcher(() => jsonResponse({ ok: true }));
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  await r.tagDataset({ namespace: 'ns', dataset: 'ds', tag: 'PII' });
  await r.untagDataset({ namespace: 'ns', dataset: 'ds', tag: 'PII' });
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(calls[0].url, 'http://mq:9000/api/v1/namespaces/ns/datasets/ds/tags/PII');
  assert.equal(calls[1].init?.method, 'DELETE');
});

test('adapter.tagJob POSTs a job tag', async () => {
  const { fetcher, calls } = recordingFetcher(() => jsonResponse({ ok: true }));
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  await r.tagJob({ namespace: 'ns', job: 'j', tag: 'PII' });
  assert.equal(calls[0].url, 'http://mq:9000/api/v1/namespaces/ns/jobs/j/tags/PII');
  assert.equal(calls[0].init?.method, 'POST');
});

test('adapter write surfaces a non-ok status', async () => {
  const { fetcher } = recordingFetcher(() => jsonResponse({}, false, 502));
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.declareTag({ name: 'X' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 502);
});

test('adapter write surfaces a thrown fetch', async () => {
  const fetcher = (async () => {
    throw new Error('boom');
  }) as unknown as typeof fetch;
  const r = createMarquezLineageReader({ baseUrl: 'http://mq:9000', fetcher });
  const res = await r.tagJob({ namespace: 'ns', job: 'j', tag: 't' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'boom');
});
