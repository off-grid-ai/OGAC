import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordChatRunGovernance } from '../src/lib/chat-run-record.ts';
import type { ChatRunWorkflowInput } from '../src/lib/chat-run.ts';

// Real test of the governed-chat-run RECORD fan-out (the seam the durable worker + the inline
// fallback both call). Exercises the REAL signing/lineage/audit adapters — the lineage + audit emits
// are best-effort (no-op without their backends), so this asserts the observable contract: a done
// run is signed for provenance + reports its status; a blocked/answerless run is not signed.

function baseInput(overrides: Partial<ChatRunWorkflowInput> = {}): ChatRunWorkflowInput {
  return {
    runId: 'chatrun_rec00001',
    conversationId: 'conv-rec',
    userId: 'u@x.io',
    model: 'gemma-local',
    query: 'what is our leave policy?',
    answer: 'You get 24 days.',
    orgId: 'default',
    project: null,
    pipelineId: null,
    checks: [{ name: 'pii', verdict: 'pass' }],
    refs: ['src:hr-handbook'],
    status: 'done',
    ...overrides,
  };
}

test('recordChatRunGovernance — a DONE run is signed for provenance + reports its status', async () => {
  const r = await recordChatRunGovernance(baseInput());
  assert.equal(r.found, true);
  assert.equal(r.runId, 'chatrun_rec00001');
  assert.equal(r.status, 'done');
  assert.ok(r.provenance, 'a done run must carry a provenance signature');
  assert.ok(r.provenance!.signature.length > 0);
  assert.ok(r.provenance!.algorithm.length > 0);
});

test('recordChatRunGovernance — a BLOCKED run (no answer) is NOT signed', async () => {
  const r = await recordChatRunGovernance(
    baseInput({ answer: '', status: 'blocked', checks: [{ name: 'injection', verdict: 'blocked' }] }),
  );
  assert.equal(r.status, 'blocked');
  assert.equal(r.provenance, null, 'a blocked/answerless run has nothing to sign');
});
