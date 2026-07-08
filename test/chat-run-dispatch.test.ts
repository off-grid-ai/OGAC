import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ChatDispatchDeps,
  dispatchChatRun,
} from '../src/lib/chat-run-dispatch.ts';
import type { ChatRunWorkflowInput, ChatRunWorkflowResult } from '../src/lib/chat-run.ts';

// Real test of the durable-vs-inline SELECTION + fallback state machine (W1). Runs the REAL
// dispatchChatRun orchestration with injected fakes at the two thin I/O boundaries (the Temporal
// submit + the in-process record) — no Temporal, no DB. Proves: durable is chosen only when
// opted-in, a submitted:false handle degrades to inline, and the run id threads identically.

function input(): ChatRunWorkflowInput {
  return {
    runId: 'chatrun_test0001',
    conversationId: 'conv1',
    userId: 'u@x.io',
    model: 'gemma-local',
    query: 'q',
    answer: 'a',
    orgId: 'default',
    project: null,
    pipelineId: null,
    checks: [],
    refs: [],
    status: 'done',
  };
}

function makeDeps(overrides: Partial<ChatDispatchDeps> & { durable?: boolean } = {}): {
  deps: ChatDispatchDeps;
  calls: { submit: ChatRunWorkflowInput[]; record: ChatRunWorkflowInput[] };
} {
  const calls = { submit: [] as ChatRunWorkflowInput[], record: [] as ChatRunWorkflowInput[] };
  const submitFn =
    overrides.submit ??
    (async (i: ChatRunWorkflowInput) => ({
      submitted: true,
      workflowId: `chatrun-conv1-${i.runId}`,
      status: 'done',
    }));
  const recordFn =
    overrides.recordInline ??
    (async (i: ChatRunWorkflowInput): Promise<ChatRunWorkflowResult> => ({
      found: true,
      runId: i.runId,
      status: i.status,
    }));
  const deps: ChatDispatchDeps = {
    durableEnabled: () => overrides.durable ?? false,
    submit: async (i) => {
      calls.submit.push(i);
      return submitFn(i);
    },
    recordInline: async (i) => {
      calls.record.push(i);
      return recordFn(i);
    },
  };
  return { deps, calls };
}

test('queue disabled ⇒ INLINE record, never submits to Temporal', async () => {
  const { deps, calls } = makeDeps({ durable: false });
  const r = await dispatchChatRun(input(), deps);
  assert.equal(r.mode, 'inline');
  assert.equal(r.runId, 'chatrun_test0001');
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.record.length, 1);
});

test('queue enabled + submit succeeds ⇒ DURABLE, returns the workflow id', async () => {
  const { deps, calls } = makeDeps({ durable: true });
  const r = await dispatchChatRun(input(), deps);
  assert.equal(r.mode, 'durable');
  assert.equal(r.workflowId, 'chatrun-conv1-chatrun_test0001');
  assert.equal(r.status, 'done');
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.record.length, 0, 'durable submit must not also record inline');
});

test('queue enabled but Temporal unreachable (submitted:false) ⇒ graceful INLINE fallback', async () => {
  const { deps, calls } = makeDeps({
    durable: true,
    submit: async () => ({ submitted: false, workflowId: 'chatrun-conv1-chatrun_test0001' }),
  });
  const r = await dispatchChatRun(input(), deps);
  assert.equal(r.mode, 'inline');
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.record.length, 1, 'a failed submit must fall through to the inline record');
});

test('the SAME runId threads through whichever path runs', async () => {
  const { deps: d1, calls: c1 } = makeDeps({ durable: true });
  await dispatchChatRun(input(), d1);
  assert.equal(c1.submit[0].runId, 'chatrun_test0001');

  const { deps: d2, calls: c2 } = makeDeps({ durable: false });
  await dispatchChatRun(input(), d2);
  assert.equal(c2.record[0].runId, 'chatrun_test0001');
});
