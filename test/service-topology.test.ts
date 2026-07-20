import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateGate,
  collectReadiness,
  countInstances,
  summarizeReadiness,
  type LogicalServiceTopology,
  type ReadinessEvidence,
} from '@/lib/service-topology';

const evidence = (
  gate: ReadinessEvidence['gate'],
  state: ReadinessEvidence['state'],
): ReadinessEvidence => ({ gate, state, summary: `${gate} ${state}`, source: 'fixture' });

const topology: LogicalServiceTopology = {
  service: {
    id: 'gateway',
    label: 'Gateway',
    description: 'Routes inference.',
    url: 'https://ai.example.test',
    auth: 'api-key',
    kind: 'gateway',
  },
  dependencies: [],
  readiness: [evidence('console-used', 'pass')],
  components: [
    {
      id: 'router',
      label: 'Router',
      role: 'routing',
      readiness: [evidence('functional', 'pass')],
      instances: [
        {
          id: 'router-g1',
          label: 'Router on g1',
          nodeId: 'g1',
          endpoints: [],
          readiness: [evidence('deployed', 'pass'), evidence('reachable', 'pass')],
        },
        {
          id: 'router-g2',
          label: 'Router on g2',
          nodeId: 'g2',
          endpoints: [],
          readiness: [evidence('deployed', 'pass'), evidence('reachable', 'unknown')],
        },
      ],
    },
  ],
};

test('gate aggregation is conservative and treats no applicable evidence as not applicable', () => {
  assert.equal(aggregateGate([]), 'not-applicable');
  assert.equal(aggregateGate([evidence('deployed', 'not-applicable')]), 'not-applicable');
  assert.equal(aggregateGate([evidence('deployed', 'pass')]), 'pass');
  assert.equal(
    aggregateGate([evidence('deployed', 'pass'), evidence('deployed', 'unknown')]),
    'unknown',
  );
  assert.equal(
    aggregateGate([evidence('deployed', 'unknown'), evidence('deployed', 'fail')]),
    'fail',
  );
});

test('topology summary collects logical, component, and dynamically sized instance evidence', () => {
  assert.equal(countInstances(topology), 2);
  assert.equal(collectReadiness(topology).length, 6);
  assert.deepEqual(summarizeReadiness(topology), {
    deployed: 'pass',
    reachable: 'unknown',
    functional: 'pass',
    seeded: 'not-applicable',
    'console-used': 'pass',
  });

  const expanded = structuredClone(topology);
  expanded.components[0]!.instances.push({
    id: 'router-g3',
    label: 'Router on g3',
    nodeId: 'g3',
    endpoints: [],
    readiness: [evidence('deployed', 'fail')],
  });
  assert.equal(countInstances(expanded), 3);
  assert.equal(summarizeReadiness(expanded).deployed, 'fail');
});
