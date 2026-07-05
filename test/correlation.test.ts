import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correlationIds, normalizeTraceId } from '../src/lib/correlation.ts';

// Pure cross-plane correlation logic (C2). No I/O, no mocks: one runId in, the four plane ids out.
// Every assertion mirrors exactly what deploy/verify-integration.sh looks up per plane.

const RUN_ID = 'run_abc12345';

test('normalizeTraceId strips non-alphanumerics (matches the harness regex)', () => {
  // Harness derives the Langfuse trace id as: printf runId | tr -cd 'a-zA-Z0-9'
  //   i.e. runId.replace(/[^a-zA-Z0-9]/g, '')
  assert.equal(normalizeTraceId('run_abc12345'), 'runabc12345');
  assert.equal(normalizeTraceId('run-XYZ_09'), 'runXYZ09');
  assert.equal(normalizeTraceId('abc'), 'abc');
  assert.equal(normalizeTraceId(''), '');
});

test('normalizeTraceId matches the exact JS the harness comment specifies', () => {
  const runId = 'run_De4dB33f';
  assert.equal(normalizeTraceId(runId), runId.replace(/[^a-zA-Z0-9]/g, ''));
});

test('all four plane ids derive from the ONE runId', () => {
  const ids = correlationIds(RUN_ID);
  // Audit (OpenSearch): doc _id / runId field == runId verbatim (queried via _search?q=<runId>).
  assert.equal(ids.auditId, RUN_ID);
  // Marquez lineage: run.runId == runId verbatim (GET /api/v1/jobs/runs/<runId>).
  assert.equal(ids.lineageRunId, RUN_ID);
  // Provenance: embedded ref == runId verbatim.
  assert.equal(ids.provenanceRef, RUN_ID);
  // Langfuse: trace id == normalized runId (GET /api/public/traces/<traceId>).
  assert.equal(ids.traceId, 'runabc12345');
  assert.equal(ids.traceId, normalizeTraceId(RUN_ID));
});

test('auditId, lineageRunId, provenanceRef are all the raw runId (round-trip to the runId)', () => {
  const ids = correlationIds(RUN_ID);
  assert.equal(ids.auditId, ids.lineageRunId);
  assert.equal(ids.lineageRunId, ids.provenanceRef);
  assert.equal(ids.provenanceRef, RUN_ID);
});

test('traceId is a pure function of the runId (deterministic, idempotent)', () => {
  const a = correlationIds(RUN_ID);
  const b = correlationIds(RUN_ID);
  assert.deepEqual(a, b);
  // Idempotent normalization: normalizing an already-normalized id is a fixed point.
  assert.equal(normalizeTraceId(a.traceId), a.traceId);
});

test('distinct runIds never collide across any plane', () => {
  const a = correlationIds('run_00000001');
  const b = correlationIds('run_00000002');
  assert.notEqual(a.auditId, b.auditId);
  assert.notEqual(a.traceId, b.traceId);
  assert.notEqual(a.lineageRunId, b.lineageRunId);
  assert.notEqual(a.provenanceRef, b.provenanceRef);
});

test('the four ids collapse to exactly two distinct values (raw runId + normalized)', () => {
  const ids = correlationIds(RUN_ID);
  const distinct = new Set([ids.auditId, ids.traceId, ids.lineageRunId, ids.provenanceRef]);
  assert.deepEqual([...distinct].sort(), ['run_abc12345', 'runabc12345'].sort());
});
