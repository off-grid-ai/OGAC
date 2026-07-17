import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pipelineBindingHttpFailure } from '../src/lib/pipeline-binding-http.ts';
import { PipelineBindingError } from '../src/lib/pipeline-run-glue.ts';

function failure(
  code: 'pipeline_unavailable' | 'binding_changed',
  reason: string,
  state: 'invalid' | 'unavailable' = 'invalid',
) {
  return new PipelineBindingError({
    state,
    pipelineId: 'pl_claims',
    contract: null,
    code,
    reason,
  });
}

test('binding HTTP failures preserve actionable 409 and 503 responses', () => {
  assert.deepEqual(pipelineBindingHttpFailure(failure('binding_changed', 'binding changed')), {
    status: 409,
    body: {
      error: 'pipeline binding unavailable',
      code: 'binding_changed',
      reason: 'binding changed',
    },
  });
  assert.deepEqual(
    pipelineBindingHttpFailure(failure('pipeline_unavailable', 'database down', 'unavailable')),
    {
      status: 503,
      body: {
        error: 'pipeline binding unavailable',
        code: 'pipeline_unavailable',
        reason: 'database down',
      },
    },
  );
  assert.equal(pipelineBindingHttpFailure(new Error('unrelated')), null);
});
