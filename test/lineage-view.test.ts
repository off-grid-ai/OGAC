import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDatasetDetail, normalizeLineage } from '../src/lib/lineage-view.ts';

// Pure Marquez → display-model normalizer. No network, no mocks — sample REST JSON in, asserted
// display model out. Covers a realistic response, empty inputs, and malformed/partial shapes.

// A trimmed but realistic Marquez response for one namespace.
const SAMPLE = {
  namespace: 'offgrid-console',
  namespaces: [{ name: 'default' }, { name: 'offgrid-console', ownerName: 'anonymous' }],
  jobs: [
    {
      name: 'agent-run',
      type: 'BATCH',
      latestRun: { state: 'COMPLETED', endedAt: '2026-07-01T10:00:00Z' },
      inputs: [
        { namespace: 'offgrid-console', name: 'corebank.customers' },
        { namespace: 'offgrid-console', name: 'policy.docs' },
      ],
      outputs: [{ namespace: 'offgrid-console', name: 'answer.grounded' }],
    },
    {
      name: 'embed-index',
      type: 'BATCH',
      latestRun: { state: 'RUNNING', startedAt: '2026-07-02T09:30:00Z' },
      inputs: [],
      outputs: [{ namespace: 'offgrid-console', name: 'vectors.faiss' }],
    },
  ],
  datasets: [
    { name: 'corebank.customers', type: 'DB_TABLE' },
    { name: 'answer.grounded', type: 'STREAM' },
  ],
};

test('normalizeLineage: builds the display model from realistic Marquez JSON', () => {
  const v = normalizeLineage(SAMPLE);

  assert.equal(v.namespace, 'offgrid-console');
  assert.deepEqual(v.namespaces, ['default', 'offgrid-console']);
  assert.deepEqual(v.counts, { namespaces: 2, jobs: 2, datasets: 2, edges: 4 });

  const agent = v.jobs.find((j) => j.name === 'agent-run');
  assert.ok(agent);
  assert.equal(agent.lastRunState, 'COMPLETED');
  assert.equal(agent.type, 'BATCH');
  assert.deepEqual(agent.inputs, ['corebank.customers', 'policy.docs']);
  assert.deepEqual(agent.outputs, ['answer.grounded']);

  // 2 input edges + 1 output edge for agent-run, 1 output edge for embed-index = 4.
  assert.equal(v.edges.filter((e) => e.kind === 'input').length, 2);
  assert.equal(v.edges.filter((e) => e.kind === 'output').length, 2);
  assert.deepEqual(v.edges[0], { from: 'corebank.customers', to: 'agent-run', kind: 'input' });

  // Freshest run timestamp across all jobs.
  assert.equal(v.lastRun, '2026-07-02T09:30:00Z');
});

test('normalizeLineage: empty / missing inputs degrade to a safe empty model', () => {
  for (const input of [null, undefined, {}, { namespaces: [], jobs: [], datasets: [] }]) {
    const v = normalizeLineage(input);
    assert.equal(v.namespace, null);
    assert.deepEqual(v.namespaces, []);
    assert.deepEqual(v.jobs, []);
    assert.deepEqual(v.datasets, []);
    assert.deepEqual(v.edges, []);
    assert.deepEqual(v.counts, { namespaces: 0, jobs: 0, datasets: 0, edges: 0 });
    assert.equal(v.lastRun, null);
  }
});

test('normalizeLineage: malformed / partial shapes never throw', () => {
  const v = normalizeLineage({
    namespace: '',
    // arrays that are not arrays, entries missing names, non-array dataset refs
    namespaces: [{ ownerName: 'x' }, { name: 'ok' }, {}],
    jobs: [
      { name: 'j1' }, // no run, no inputs/outputs
      { latestRun: { state: 'weird-state' }, inputs: [{ name: 'in' }, {}] }, // unnamed job + bad ref
      { name: 'j3', latestRun: { state: 'FAIL' } },
    ],
    datasets: [{ type: 'DB_TABLE' }, { name: 'd1' }],
  });

  assert.equal(v.namespace, null); // empty string → null
  assert.deepEqual(v.namespaces, ['ok']); // only real names kept
  assert.equal(v.jobs.length, 3);
  assert.equal(v.jobs[0].lastRunState, 'UNKNOWN'); // no run
  assert.equal(v.jobs[1].name, '(unnamed)'); // missing name fallback
  assert.equal(v.jobs[1].lastRunState, 'UNKNOWN'); // unrecognized state
  assert.deepEqual(v.jobs[1].inputs, ['in']); // bad ref dropped
  assert.equal(v.jobs[2].lastRunState, 'FAILED'); // FAIL → FAILED alias
  assert.equal(v.datasets[0].name, '(unnamed)');
  assert.equal(v.lastRun, null); // no timestamps present
  // one input edge from j2's 'in'
  assert.deepEqual(v.edges, [{ from: 'in', to: '(unnamed)', kind: 'input' }]);
});

// ── normalizeDatasetDetail — single-dataset read (schema + facets + tags) ──────────────────────
test('normalizeDatasetDetail: lifts fields, tags, facet names + rowCount/bytes', () => {
  const d = normalizeDatasetDetail({
    name: 'answer.grounded',
    namespace: 'offgrid-console',
    type: 'STREAM',
    description: 'grounded answers',
    updatedAt: '2026-07-01T10:00:00Z',
    fields: [
      { name: 'id', type: 'string', description: 'pk' },
      { name: 'text', type: 'string' },
      { type: 'noname' }, // dropped
    ],
    tags: ['pii', { name: 'critical' }, { name: '' }],
    facets: {
      schema: { fields: [] },
      dataQualityMetrics: { rowCount: 42, bytes: 8192 },
    },
  });
  assert.ok(d);
  assert.equal(d.name, 'answer.grounded');
  assert.equal(d.namespace, 'offgrid-console');
  assert.equal(d.type, 'STREAM');
  assert.equal(d.fields.length, 2);
  assert.deepEqual(d.fields[0], { name: 'id', type: 'string', description: 'pk' });
  assert.deepEqual(d.tags, ['pii', 'critical']); // empty tag dropped
  assert.deepEqual(d.facetNames.sort(), ['dataQualityMetrics', 'schema']);
  assert.equal(d.rowCount, 42);
  assert.equal(d.bytes, 8192);
});

test('normalizeDatasetDetail: null/nameless → null; missing facets degrade safely', () => {
  assert.equal(normalizeDatasetDetail(null), null);
  assert.equal(normalizeDatasetDetail(undefined), null);
  assert.equal(normalizeDatasetDetail({ type: 'x' }), null); // no name
  const bare = normalizeDatasetDetail({ name: 'd' });
  assert.ok(bare);
  assert.deepEqual(bare.fields, []);
  assert.deepEqual(bare.tags, []);
  assert.deepEqual(bare.facetNames, []);
  assert.equal(bare.rowCount, null);
  assert.equal(bare.bytes, null);
});
