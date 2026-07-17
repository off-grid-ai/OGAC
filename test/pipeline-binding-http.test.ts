import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pipelineBindingHttpFailure } from '../src/lib/pipeline-binding-http.ts';
import { PipelineBindingError } from '../src/lib/pipeline-run-glue.ts';

function failure(
  code: 'pipeline_unavailable' | 'binding_changed',
  reason: string,
) {
  return new PipelineBindingError({
    state: 'invalid',
    pipelineId: 'pl_claims',
    contract: null,
    code,
    reason,
  });
}

function unavailableFailure(reason: string) {
  return new PipelineBindingError({
    state: 'unavailable',
    pipelineId: 'pl_claims',
    contract: null,
    code: 'resolver_unavailable',
    reason,
  });
}

test('binding HTTP failures preserve actionable 409/503 responses and one audit projection', () => {
  assert.deepEqual(
    pipelineBindingHttpFailure(failure('binding_changed', 'binding changed'), {
      ingress: 'webhook:wh_1',
      target: 'agent:a_1',
    }),
    {
    status: 409,
    body: {
      error: 'pipeline binding unavailable',
      code: 'binding_changed',
      reason: 'binding changed',
      pipelineId: 'pl_claims',
      nextAction: 'Reload the consumer and retry with its current pipeline binding.',
    },
    audit: {
      action: 'trigger.denied',
      resource: 'webhook:wh_1 agent:a_1 pipeline-binding:binding_changed',
      outcome: 'blocked',
    },
    },
  );
  assert.deepEqual(
    pipelineBindingHttpFailure(unavailableFailure('database down')),
    {
      status: 503,
      body: {
        error: 'pipeline binding unavailable',
        code: 'resolver_unavailable',
        reason: 'database down',
        pipelineId: 'pl_claims',
        nextAction: 'Restore the control-plane database, then retry; execution was not started.',
      },
      audit: {
        action: 'trigger.denied',
        resource: 'ingress:unknown consumer:unknown pipeline-binding:resolver_unavailable',
        outcome: 'blocked',
      },
    },
  );
  assert.equal(pipelineBindingHttpFailure(new Error('unrelated')), null);
});
