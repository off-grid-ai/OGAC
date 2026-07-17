import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createServiceTopologyRegistry,
  parseServiceTopologyRecords,
  type ServiceTopologyRecord,
} from '@/lib/adapters/service-topology-registry';
import type { ServiceEntry } from '@/lib/service-entry';

const service: ServiceEntry = {
  id: 'gateway',
  label: 'AI Gateway',
  description: 'Routes inference.',
  url: 'https://user:secret@offgrid-g7.local:4000/private?token=secret',
  auth: 'api-key',
  kind: 'gateway',
};

const configuredRecord: ServiceTopologyRecord = {
  serviceId: 'gateway',
  dependencies: [{ serviceId: 'litellm', purpose: 'model routing', required: true }],
  readiness: [
    {
      gate: 'console-used',
      state: 'pass',
      summary: 'Chat reaches the gateway.',
      source: 'integration harness',
    },
  ],
  components: [
    {
      id: 'router',
      label: 'Router',
      role: 'routing',
      readiness: [],
      instances: ['g2', 'g4', 'g7'].map((nodeId) => ({
        id: `router-${nodeId}`,
        label: `Router on ${nodeId}`,
        nodeId,
        endpoints: [
          {
            id: `router-${nodeId}-http`,
            label: 'HTTP',
            url: `http://token:secret@offgrid-${nodeId}.local:4000/private?token=secret`,
            purpose: 'Inference',
            scope: 'lan' as const,
          },
        ],
        readiness: [
          {
            gate: 'deployed' as const,
            state: 'pass' as const,
            summary: 'Deployment inventory includes this instance.',
            source: 'fleet registry',
          },
        ],
      })),
    },
  ],
};

test('registry overlays dynamically sized topology records onto logical services', () => {
  const registry = createServiceTopologyRegistry({
    listServices: () => [service],
    listTopologyRecords: () => [configuredRecord],
  });
  const topology = registry.find('gateway');

  assert.equal(topology?.service, service);
  assert.equal(topology?.components.length, 1);
  assert.deepEqual(
    topology?.components[0]?.instances.map((instance) => instance.nodeId),
    ['g2', 'g4', 'g7'],
  );
  assert.equal(topology?.dependencies[0]?.serviceId, 'litellm');
  assert.equal(registry.find('missing'), undefined);
});

test('registry fallback derives one honest instance without claiming functional integration', () => {
  const registry = createServiceTopologyRegistry({
    listServices: () => [service],
    listTopologyRecords: () => [],
  });
  const topology = registry.list()[0]!;

  assert.equal(topology.components[0]?.instances[0]?.nodeId, 'g7');
  assert.equal(topology.components[0]?.instances[0]?.endpoints[0]?.scope, 'lan');
  assert.equal(
    topology.readiness.find((item) => item.gate === 'functional')?.state,
    'unknown',
  );
  assert.equal(
    topology.readiness.find((item) => item.gate === 'console-used')?.state,
    'unknown',
  );
});

test('embedded fallback is deployed in-process and non-url targets remain in-process', () => {
  const embedded = { ...service, id: 'lancedb', url: 'embedded://lancedb', probe: 'embedded' as const };
  const topology = createServiceTopologyRegistry({
    listServices: () => [embedded],
    listTopologyRecords: () => [],
  }).list()[0]!;

  assert.equal(topology.components[0]?.instances[0]?.nodeId, null);
  assert.equal(topology.components[0]?.instances[0]?.endpoints[0]?.scope, 'in-process');
  assert.equal(topology.readiness.find((item) => item.gate === 'deployed')?.state, 'pass');
});

test('deployment topology parser accepts complete records and rejects malformed documents atomically', () => {
  assert.deepEqual(parseServiceTopologyRecords(JSON.stringify([configuredRecord])), [configuredRecord]);
  assert.deepEqual(parseServiceTopologyRecords(undefined), []);
  assert.deepEqual(parseServiceTopologyRecords('not json'), []);
  assert.deepEqual(parseServiceTopologyRecords('{}'), []);
  assert.deepEqual(
    parseServiceTopologyRecords(JSON.stringify([configuredRecord, { serviceId: 'bad' }])),
    [],
  );
});
