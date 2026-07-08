import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTraceBatch, type ChatTraceInput } from '@/lib/chat-trace';

// PA-12 — PURE unit tests for the Langfuse ingestion-batch builder. The live trace push can't be
// integration-tested without a real Langfuse, so we test the metadata-builder that produces the
// trace payload directly (as the deliverable's TESTS section calls for): that a run's bound
// pipeline is stamped at the SOURCE as the canonical `pipeline:<id>` tag + a `pipelineId` metadata
// field, and that a run with NO bound pipeline emits a byte-identical (untagged) trace.

const BASE: ChatTraceInput = {
  conversationId: 'conv1',
  userId: 'u@example.com',
  model: 'gemma-local',
  input: 'q',
  output: 'a',
  traceId: 'trace-fixed', // deterministic so we assert the trace body, not the random default
};

function traceBody(batch: unknown[]): Record<string, unknown> {
  const traceEvent = batch.find(
    (e) => (e as { type?: string }).type === 'trace-create',
  ) as { body: Record<string, unknown> };
  return traceEvent.body;
}

test('buildTraceBatch stamps the canonical pipeline tag + metadata when a pipeline is bound', () => {
  const body = traceBody(buildTraceBatch({ ...BASE, pipelineId: 'pl_abc' }));
  assert.deepEqual(body.tags, ['pipeline:pl_abc'], 'canonical pipeline tag in tags[]');
  assert.deepEqual(body.metadata, { pipelineId: 'pl_abc' }, 'pipelineId in metadata');
  assert.equal(body.id, 'trace-fixed');
});

test('buildTraceBatch trims a padded pipeline id to the canonical form', () => {
  const body = traceBody(buildTraceBatch({ ...BASE, pipelineId: '  pl_abc  ' }));
  assert.deepEqual(body.tags, ['pipeline:pl_abc']);
  assert.deepEqual(body.metadata, { pipelineId: 'pl_abc' });
});

test('buildTraceBatch adds NO pipeline tag/metadata for an un-piped run (legacy behaviour)', () => {
  for (const pipelineId of [undefined, null, '', '   ']) {
    const body = traceBody(buildTraceBatch({ ...BASE, pipelineId }));
    assert.equal('tags' in body, false, `no tags for pipelineId=${JSON.stringify(pipelineId)}`);
    assert.equal('metadata' in body, false, `no metadata for pipelineId=${JSON.stringify(pipelineId)}`);
  }
});

test('buildTraceBatch still emits the trace + generation observation regardless of pipeline', () => {
  const batch = buildTraceBatch({ ...BASE, pipelineId: 'pl_abc' });
  const types = batch.map((e) => (e as { type?: string }).type);
  assert.deepEqual(types, ['trace-create', 'generation-create']);
});
