import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEvent } from '../src/lib/adapters/lineage.ts';
import {
  buildColumnLineageFacet,
  buildDataQualityFacet,
  buildDatasetFacets,
  buildDatasetObject,
  buildSchemaFacet,
} from '../src/lib/lineage-facets.ts';

// Pure OpenLineage facet builders + the RunEvent facet attachment. No network, no mocks —
// representative producer input in, asserted OpenLineage facet JSON out.

const OL = 'https://openlineage.io/spec/facets';
const PRODUCER = 'https://github.com/offgrid/console';

test('buildSchemaFacet: fields with reserved keys, drops nameless, omits when empty', () => {
  const f = buildSchemaFacet([
    { name: 'id', type: 'string', description: 'pk' },
    { name: 'amount', type: 'number' },
    { type: 'string' }, // nameless → dropped
    { name: '   ' }, // whitespace → dropped
  ]);
  assert.ok(f);
  assert.equal(f._producer, PRODUCER);
  assert.equal(f._schemaURL, `${OL}/SchemaDatasetFacet.json`);
  assert.deepEqual(f.fields, [
    { name: 'id', type: 'string', description: 'pk' },
    { name: 'amount', type: 'number' },
  ]);
  // Nothing usable → undefined, not an empty facet.
  assert.equal(buildSchemaFacet([]), undefined);
  assert.equal(buildSchemaFacet(undefined), undefined);
  assert.equal(buildSchemaFacet([{ type: 'x' }]), undefined);
});

test('buildColumnLineageFacet: maps output field → input fields, drops empty entries', () => {
  const f = buildColumnLineageFacet([
    {
      field: 'full_name',
      inputFields: [
        { namespace: 'ns', dataset: 'people', field: 'first' },
        { namespace: 'ns', dataset: 'people', field: 'last' },
      ],
      transformationType: 'CONCAT',
    },
    { field: 'no_inputs', inputFields: [] }, // dropped (no input fields)
    { field: '', inputFields: [{ field: 'x' }] }, // dropped (no output field)
  ]);
  assert.ok(f);
  assert.equal(f._schemaURL, `${OL}/ColumnLineageDatasetFacet.json`);
  const fields = f.fields as Record<string, { inputFields: unknown[]; transformationType?: string }>;
  assert.deepEqual(Object.keys(fields), ['full_name']);
  assert.equal(fields.full_name.transformationType, 'CONCAT');
  assert.deepEqual(fields.full_name.inputFields, [
    { namespace: 'ns', name: 'people', field: 'first' },
    { namespace: 'ns', name: 'people', field: 'last' },
  ]);
  assert.equal(buildColumnLineageFacet([]), undefined);
});

test('buildDataQualityFacet: lifts row/byte counts + per-column metrics, omits all-empty', () => {
  const f = buildDataQualityFacet({
    rowCount: 1200,
    byteCount: 4096,
    columns: {
      email: { nullCount: 3, distinctCount: 1197 },
      empty: {}, // no numeric metric → column dropped
    },
  });
  assert.ok(f);
  assert.equal(f._schemaURL, `${OL}/DataQualityMetricsInputDatasetFacet.json`);
  assert.equal(f.rowCount, 1200);
  assert.equal(f.bytes, 4096);
  const cm = f.columnMetrics as Record<string, unknown>;
  assert.deepEqual(Object.keys(cm), ['email']);
  assert.deepEqual(cm.email, { nullCount: 3, distinctCount: 1197 });
  // No numeric info anywhere → undefined.
  assert.equal(buildDataQualityFacet({ columns: { a: {} } }), undefined);
  assert.equal(buildDataQualityFacet(undefined), undefined);
  // NaN / non-number ignored.
  assert.equal(buildDataQualityFacet({ rowCount: 'lots' as unknown as number }), undefined);
});

test('buildDatasetFacets: assembles present facets under OpenLineage keys, undefined when none', () => {
  const facets = buildDatasetFacets({
    fields: [{ name: 'id' }],
    dataQuality: { rowCount: 5 },
  });
  assert.ok(facets);
  assert.deepEqual(Object.keys(facets).sort(), ['dataQualityMetrics', 'schema']);
  assert.equal(buildDatasetFacets({}), undefined);
  assert.equal(buildDatasetFacets(undefined), undefined);
});

test('buildDatasetObject: bare when no spec, facets attached when spec matches by name', () => {
  const specs = [{ name: 'answer.grounded', fields: [{ name: 'id', type: 'string' }] }];
  assert.deepEqual(buildDatasetObject('offgrid-console', 'other', specs), {
    namespace: 'offgrid-console',
    name: 'other',
  });
  const withFacets = buildDatasetObject('offgrid-console', 'answer.grounded', specs);
  assert.equal(withFacets.name, 'answer.grounded');
  assert.ok(withFacets.facets?.schema);
  // No specs at all → bare.
  assert.deepEqual(buildDatasetObject('ns', 'd', undefined), { namespace: 'ns', name: 'd' });
});

test('runEvent: emits OpenLineage RunEvent and attaches facets to the matching output', () => {
  const ev = runEvent(
    {
      job: 'brain.ingest',
      run: 'run-1',
      status: 'COMPLETE',
      inputs: ['File · notes.txt'],
      outputs: ['My Doc'],
      facets: [{ name: 'My Doc', fields: [{ name: 'text', type: 'string' }] }],
    },
    '2026-07-05T00:00:00Z',
  );
  assert.equal(ev.eventType, 'COMPLETE');
  assert.equal(ev.job.name, 'brain.ingest');
  assert.equal(ev.run.runId, 'run-1');
  // Input has no matching facet spec → bare.
  assert.equal(ev.inputs[0].facets, undefined);
  assert.equal(ev.inputs[0].name, 'File · notes.txt');
  // Output carries the schema facet.
  assert.ok(ev.outputs[0].facets?.schema);
});

test('runEvent: FAIL status maps to FAIL eventType', () => {
  const ev = runEvent({ job: 'j', run: 'r', status: 'FAIL' }, '2026-07-05T00:00:00Z');
  assert.equal(ev.eventType, 'FAIL');
  assert.deepEqual(ev.inputs, []);
  assert.deepEqual(ev.outputs, []);
});

test('runEvent: nominalStartTime attaches a NominalTimeRunFacet (run start + duration in Marquez)', () => {
  const ev = runEvent(
    { job: 'agent:a', run: 'r', status: 'START', nominalStartTime: '2026-07-05T00:00:00Z' },
    '2026-07-05T00:00:00Z',
  ) as { run: { facets?: { nominalTime?: { nominalStartTime?: string; nominalEndTime?: string } } } };
  assert.equal(ev.run.facets?.nominalTime?.nominalStartTime, '2026-07-05T00:00:00Z');
  assert.equal(ev.run.facets?.nominalTime?.nominalEndTime, undefined);
});

test('runEvent: nominalEndTime is added on the COMPLETE', () => {
  const ev = runEvent(
    {
      job: 'agent:a',
      run: 'r',
      status: 'COMPLETE',
      nominalStartTime: '2026-07-05T00:00:00Z',
      nominalEndTime: '2026-07-05T00:00:09Z',
    },
    '2026-07-05T00:00:09Z',
  ) as { run: { facets?: { nominalTime?: { nominalEndTime?: string } } } };
  assert.equal(ev.run.facets?.nominalTime?.nominalEndTime, '2026-07-05T00:00:09Z');
});

test('runEvent: jobDescription attaches a DocumentationJobFacet', () => {
  const ev = runEvent(
    { job: 'agent:a', run: 'r', status: 'START', jobDescription: 'Governed agent run: Triage' },
    '2026-07-05T00:00:00Z',
  ) as { job: { facets?: { documentation?: { description?: string } } } };
  assert.equal(ev.job.facets?.documentation?.description, 'Governed agent run: Triage');
});

test('runEvent: no timing/description → bare run + job (back-compat)', () => {
  const ev = runEvent({ job: 'j', run: 'r', status: 'COMPLETE' }, '2026-07-05T00:00:00Z') as {
    run: { facets?: unknown };
    job: { facets?: unknown };
  };
  assert.equal(ev.run.facets, undefined);
  assert.equal(ev.job.facets, undefined);
});
