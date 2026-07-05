import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  correlationIds,
  lineageRunUuid,
  LINEAGE_UUID_NAMESPACE,
  normalizeTraceId,
  uuidv5,
} from '../src/lib/correlation.ts';

// Pure cross-plane correlation logic (C2). No I/O, no mocks: one runId in, the four plane ids out.
// Every assertion mirrors exactly what deploy/verify-integration.sh looks up per plane.

const RUN_ID = 'run_abc12345';
// RFC-4122 UUID with version 5 and RFC variant (8/9/a/b): xxxxxxxx-xxxx-5xxx-[89ab]xxx-xxxxxxxxxxxx.
const UUID_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

test('uuidv5 is a valid RFC-4122 v5 UUID (version=5, RFC variant)', () => {
  assert.match(uuidv5('run_b16393c5'), UUID_V5_RE);
  assert.match(uuidv5(RUN_ID), UUID_V5_RE);
  assert.match(uuidv5(''), UUID_V5_RE);
});

test('uuidv5 is deterministic (same name+namespace → same UUID) and namespace-sensitive', () => {
  assert.equal(uuidv5('run_x'), uuidv5('run_x'));
  assert.notEqual(uuidv5('run_x'), uuidv5('run_y'));
  // Different namespace → different UUID for the same name.
  assert.notEqual(uuidv5('run_x'), uuidv5('run_x', '00000000-0000-0000-0000-000000000000'));
});

test('uuidv5 matches known reference vectors (locks the algorithm — mirrored in the bash harness)', () => {
  // These are the exact values the bash `uuid5` in verify-integration.sh must reproduce.
  assert.equal(uuidv5('run_b16393c5'), 'db36b49b-4e9e-546e-8896-d4d49e5057b0');
  assert.equal(uuidv5('run_abc12345'), '2839281d-910f-5bf0-a1ee-335e71d6a2be');
  assert.equal(uuidv5('run_00000001'), 'd0417fbf-aafb-5d0c-8ffe-e3dcecff55e4');
});

test('lineageRunUuid == uuidv5 under the fixed lineage namespace', () => {
  assert.equal(lineageRunUuid(RUN_ID), uuidv5(RUN_ID, LINEAGE_UUID_NAMESPACE));
  assert.equal(lineageRunUuid(RUN_ID), uuidv5(RUN_ID));
});

test('all four plane ids derive from the ONE runId', () => {
  const ids = correlationIds(RUN_ID);
  // Audit (OpenSearch): doc _id / runId field == runId verbatim (queried via _search?q=<runId>).
  assert.equal(ids.auditId, RUN_ID);
  // Provenance: embedded ref == runId verbatim.
  assert.equal(ids.provenanceRef, RUN_ID);
  // Langfuse: trace id == normalized runId (GET /api/public/traces/<traceId>).
  assert.equal(ids.traceId, 'runabc12345');
  assert.equal(ids.traceId, normalizeTraceId(RUN_ID));
  // Marquez lineage: run.runId is a UUIDv5 of the runId (Marquez requires a UUID run id).
  assert.match(ids.lineageRunId, UUID_V5_RE);
  assert.equal(ids.lineageRunId, lineageRunUuid(RUN_ID));
});

test('lineageRunId is a UUID, NOT the raw runId (the C2 Marquez root-cause fix)', () => {
  const ids = correlationIds(RUN_ID);
  assert.notEqual(ids.lineageRunId, RUN_ID);
  assert.match(ids.lineageRunId, UUID_V5_RE);
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

test('auditId == provenanceRef == raw runId; traceId + lineageRunId are the two derived forms', () => {
  const ids = correlationIds(RUN_ID);
  assert.equal(ids.auditId, RUN_ID);
  assert.equal(ids.provenanceRef, RUN_ID);
  assert.equal(ids.auditId, ids.provenanceRef);
  // The four ids collapse to exactly three distinct values: raw runId, normalized, uuid5.
  const distinct = new Set([ids.auditId, ids.traceId, ids.lineageRunId, ids.provenanceRef]);
  assert.equal(distinct.size, 3);
});
