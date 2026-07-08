import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emitChatTrace, emitRunTrace } from '@/lib/chat-trace';

// The fire-and-forget Langfuse emit entry points. With no OFFGRID_LANGFUSE_* env (the test default),
// `configured()` is false so both no-op WITHOUT any network call — the documented contract that they
// "no-op when Langfuse env is unset" and "never reject into the caller". We assert they return
// synchronously (void) and never throw, exercising the guard + authHeader/configured path.

test('emitChatTrace: no-ops (returns void, does not throw) when Langfuse is unconfigured', () => {
  const r = emitChatTrace({
    conversationId: 'c1',
    userId: 'u1',
    model: 'gemma-local',
    input: 'hello',
    output: 'hi there',
  });
  assert.equal(r, undefined);
});

test('emitChatTrace: also no-ops when output is empty (guard before any work)', () => {
  assert.equal(
    emitChatTrace({ conversationId: 'c1', userId: 'u1', model: 'm', input: 'q', output: '' }),
    undefined,
  );
});

test('emitRunTrace: no-ops (returns void, does not throw) when unconfigured', () => {
  const r = emitRunTrace({
    runId: 'run-123',
    agentId: 'agent-a',
    model: 'gemma-local',
    input: 'do the thing',
    output: 'done',
    pipelineId: 'p1',
  });
  assert.equal(r, undefined);
});

test('emitRunTrace: no-ops when output is empty', () => {
  assert.equal(
    emitRunTrace({ runId: 'r', agentId: 'a', model: 'm', input: 'i', output: '' }),
    undefined,
  );
});
