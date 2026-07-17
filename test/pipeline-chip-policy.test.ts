import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explicitConsumerPipelineId } from '../src/lib/pipeline-chip.ts';

test('App and runtime-agent chips never inherit the org Chat default', () => {
  assert.equal(explicitConsumerPipelineId(null), null);
  assert.equal(explicitConsumerPipelineId(undefined), null);
  assert.equal(explicitConsumerPipelineId('   '), null);
  assert.equal(explicitConsumerPipelineId(' pl_claims '), 'pl_claims');
});
