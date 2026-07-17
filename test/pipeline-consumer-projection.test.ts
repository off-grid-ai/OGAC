import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operatorPipelineConsumers } from '../src/lib/pipeline-consumers.ts';

test('operator consumer inventory shows an App once while retaining independent agents', () => {
  const projected = operatorPipelineConsumers([
    { kind: 'app', id: 'app_claims', label: 'Claims decision' },
    {
      kind: 'runtime_agent',
      id: 'agent_materialized',
      label: 'Claims decision · Decide',
      ownerAppId: 'app_claims',
    },
    {
      kind: 'runtime_agent',
      id: 'agent_independent',
      label: 'Reusable classifier',
      ownerAppId: null,
    },
  ]);
  assert.deepEqual(projected, [
    { kind: 'app', id: 'app_claims', label: 'Claims decision' },
    {
      kind: 'runtime_agent',
      id: 'agent_independent',
      label: 'Reusable classifier',
      ownerAppId: null,
    },
  ]);
});

