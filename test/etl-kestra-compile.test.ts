import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateDagSpec,
  defaultDag,
  topoOrder,
  isSafeExpression,
  flattenDagToJobFields,
  sourceNodes,
  destinationNodes,
  transformNodes,
  type EtlDagSpec,
} from '../src/lib/etl-job.ts';
import {
  compileToKestraFlow,
  compileSteps,
  nodeToStep,
  toYaml,
  kestraFlowId,
  KESTRA_NAMESPACE,
  compileManagedBlueprintToKestraFlow,
} from '../src/lib/etl-kestra-compile.ts';

// PURE unit tests: DAG validation + the DAG→Kestra-flow compiler. No DB, no network, no live box —
// the compiler is a pure mapper so it's pinned against expected YAML/structure with real functions.

// ── a representative valid DAG: source → redact → filter → destination ──────────────────────────
function sampleDag(): EtlDagSpec {
  return {
    nodes: [
      { id: 'src', kind: 'source', label: 'CRM', config: { connectorId: 'c1', resource: 'customers' } },
      { id: 'r1', kind: 'redact', label: 'Mask PAN', config: { column: 'pan', action: 'mask', keepLast: 4 } },
      { id: 'f1', kind: 'filter', label: 'Active', config: { column: 'status', op: 'eq', value: 'active' } },
      { id: 'dst', kind: 'destination', label: 'WH', config: { database: 'analytics', table: 'customers' } },
    ],
    edges: [
      { from: 'src', to: 'r1' },
      { from: 'r1', to: 'f1' },
      { from: 'f1', to: 'dst' },
    ],
    trigger: 'manual',
  };
}

// ── validation ────────────────────────────────────────────────────────────────────────────────
test('validateDagSpec accepts a well-formed source→transform→destination DAG', () => {
  assert.deepEqual(validateDagSpec(sampleDag()), { ok: true, errors: [] });
});

test('defaultDag() is a valid two-node stub once its source/destination are configured', () => {
  const d = defaultDag();
  // stub has empty configs → invalid until filled
  assert.equal(validateDagSpec(d).ok, false);
  d.nodes[0].config = { connectorId: 'c1', resource: 't' };
  d.nodes[1].config = { database: 'db', table: 't' };
  assert.deepEqual(validateDagSpec(d), { ok: true, errors: [] });
});

test('validateDagSpec requires a source and a destination', () => {
  const r = validateDagSpec({ nodes: [], edges: [], trigger: 'manual' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /source node/.test(e)));
  assert.ok(r.errors.some((e) => /destination node/.test(e)));
});

test('validateDagSpec rejects an unsafe destination identifier', () => {
  const d = sampleDag();
  d.nodes[3].config.table = 'bad-table;drop';
  const r = validateDagSpec(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /must be a valid identifier/.test(e)));
});

test('validateDagSpec rejects an unsafe derive expression but accepts arithmetic', () => {
  assert.equal(isSafeExpression('amount * 1.18'), true);
  assert.equal(isSafeExpression('a + b - c'), true);
  assert.equal(isSafeExpression('require("fs")'), false);
  assert.equal(isSafeExpression('x; process.exit()'), false);
  assert.equal(isSafeExpression('`${x}`'), false);
  assert.equal(isSafeExpression(''), false);
});

test('validateDagSpec catches a cycle', () => {
  const d = sampleDag();
  d.edges.push({ from: 'dst', to: 'src' }); // cycle
  const r = validateDagSpec(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /cycle|disconnected|dangling/.test(e)));
});

test('validateDagSpec requires a valid cron when scheduled', () => {
  const d = sampleDag();
  d.trigger = 'schedule';
  assert.equal(validateDagSpec(d).ok, false);
  d.cron = '0 3 * * *';
  assert.deepEqual(validateDagSpec(d), { ok: true, errors: [] });
});

// ── topo order + node selectors ─────────────────────────────────────────────────────────────────
test('topoOrder linearizes the DAG source-first, destination-last', () => {
  const order = topoOrder(sampleDag());
  assert.ok(order);
  assert.deepEqual(
    order!.map((n) => n.id),
    ['src', 'r1', 'f1', 'dst'],
  );
});

test('node selectors partition the graph', () => {
  const d = sampleDag();
  assert.equal(sourceNodes(d).length, 1);
  assert.equal(destinationNodes(d).length, 1);
  assert.equal(transformNodes(d).length, 2);
});

// ── nodeToStep + compileSteps ────────────────────────────────────────────────────────────────────
test('nodeToStep emits the declarative step per node kind', () => {
  assert.deepEqual(nodeToStep(sampleDag().nodes[1]), {
    kind: 'redact',
    column: 'pan',
    action: 'mask',
    keepLast: 4,
  });
  assert.deepEqual(nodeToStep(sampleDag().nodes[2]), {
    kind: 'filter',
    column: 'status',
    op: 'eq',
    value: 'active',
  });
});

test('compileSteps returns the ordered pipeline', () => {
  const steps = compileSteps(sampleDag());
  assert.ok(steps);
  assert.deepEqual(steps!.map((s) => s.kind), ['source', 'redact', 'filter', 'destination']);
});

// ── the compiler → a valid Kestra flow YAML ──────────────────────────────────────────────────────
test('compileToKestraFlow produces a valid flow with the right id/namespace/tasks', () => {
  const { flowId, namespace, yaml, steps } = compileToKestraFlow(sampleDag(), 'etl_abc123', 'Nightly CRM');
  assert.equal(flowId, 'etl_abc123');
  assert.equal(namespace, KESTRA_NAMESPACE);
  assert.equal(steps.length, 4);
  // Structural assertions on the emitted YAML (a real Kestra flow needs id/namespace/tasks).
  assert.match(yaml, /^id: etl_abc123$/m);
  assert.match(yaml, /^namespace: offgrid\.etl$/m);
  assert.match(yaml, /io\.kestra\.plugin\.scripts\.python\.Script/);
  assert.match(yaml, /^tasks:/m);
  assert.match(yaml, /id: run_pipeline/);
  // The steps input carries the compiled pipeline JSON.
  assert.match(yaml, /id: steps/);
  assert.match(yaml, /type: JSON/);
  // Manual trigger → no Schedule trigger block.
  assert.doesNotMatch(yaml, /io\.kestra\.plugin\.core\.trigger\.Schedule/);
});

test('compileToKestraFlow emits a Schedule trigger for a scheduled job', () => {
  const d = sampleDag();
  d.trigger = 'schedule';
  d.cron = '0 3 * * *';
  const { yaml } = compileToKestraFlow(d, 'etl_sched', 'Sched');
  assert.match(yaml, /io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(yaml, /cron: '0 3 \* \* \*'/);
});

test('managed delinquency blueprint compiles real least-privilege business work', () => {
  const { yaml, namespace, flowId } = compileManagedBlueprintToKestraFlow(
    'bfsi-delinquency-snapshot',
    'etl_delinquency',
    'Delinquency exposure snapshot',
    'schedule',
    '15 1 * * *',
  );
  assert.equal(namespace, 'offgrid.etl');
  assert.equal(flowId, 'etl_delinquency');
  assert.match(yaml, /INSERT INTO bfsi\.delinquency_orchestration_audit/);
  assert.match(yaml, /FROM bfsi\.fact_loan/);
  assert.match(yaml, /dpd > 30 AND status != 'closed'/);
  assert.match(yaml, /console_run_id/);
  assert.match(yaml, /execution\.id/);
  assert.match(yaml, /disabled: false/);
  assert.match(yaml, /username: '\{\{ envs\.clickhouse_user \}\}'/);
  assert.match(yaml, /secret\(''CLICKHOUSE_PASSWORD''\)/);
  assert.doesNotMatch(yaml, /CREATE TABLE|ALTER TABLE|DROP TABLE/);
  assert.doesNotMatch(yaml, /offgrid\.production/);
});

test('managed blueprint rejects unknown workflow keys', () => {
  assert.throws(
    () =>
      compileManagedBlueprintToKestraFlow(
        'unknown' as 'bfsi-delinquency-snapshot',
        'etl_bad',
        'bad',
        'manual',
      ),
    /Unsupported managed ETL blueprint/,
  );
});

test('kestraFlowId sanitizes to Kestra id rules', () => {
  assert.equal(kestraFlowId('etl_abc-123.x'), 'etl_abc-123.x');
  assert.equal(kestraFlowId('bad id!@#'), 'bad_id___');
});

// ── the YAML emitter is safe + round-trippable in shape ──────────────────────────────────────────
test('toYaml quotes strings that need it and emits block scalars for multiline', () => {
  const y = toYaml({ a: 'plain', b: 'has: colon', c: 'line1\nline2', d: ['x', 'y'] });
  assert.match(y, /^a: plain$/m);
  assert.match(y, /^b: 'has: colon'$/m);
  assert.match(y, /^c: \|$/m);
  assert.match(y, /^ {2}line1$/m);
  assert.match(y, /^ {2}line2$/m);
  assert.match(y, /^d:$/m);
  // block sequence items sit at the parent key's indent (valid YAML)
  assert.match(y, /^- x$/m);
});

// ── flattenDagToJobFields keeps the flat model in sync ───────────────────────────────────────────
test('flattenDagToJobFields derives flat source/dest/mappings from the DAG', () => {
  const flat = flattenDagToJobFields(sampleDag());
  assert.equal(flat.sourceConnectorId, 'c1');
  assert.equal(flat.sourceResource, 'customers');
  assert.equal(flat.destDatabase, 'analytics');
  assert.equal(flat.destTable, 'customers');
  // the redact node becomes a mapping with its action
  assert.deepEqual(flat.mappings, [{ source: 'pan', dest: undefined, action: 'mask', keepLast: 4 }]);
  assert.ok(flat.dag);
});
