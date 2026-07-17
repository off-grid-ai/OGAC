import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseAgentPipelineId,
  resolveAgentPipeline,
} from '../src/lib/agent-pipeline-policy.ts';

test('agent pipeline binding is explicit: null/blank stays unbound and never falls back', () => {
  assert.equal(resolveAgentPipeline(null), null);
  assert.equal(resolveAgentPipeline(undefined), null);
  assert.equal(resolveAgentPipeline('   '), null);
});

test('agent pipeline binding trims and preserves an explicit pipeline id', () => {
  assert.equal(resolveAgentPipeline('  pl_claims  '), 'pl_claims');
});

test('untrusted agent pipeline ids reject non-strings while accepting deliberate null', () => {
  assert.deepEqual(parseAgentPipelineId(42), { ok: false, pipelineId: null });
  assert.deepEqual(parseAgentPipelineId(null), { ok: true, pipelineId: null });
});
