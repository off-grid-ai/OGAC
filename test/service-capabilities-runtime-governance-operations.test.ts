import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_GOVERNANCE_OPERATIONS_AUDITS,
  RUNTIME_GOVERNANCE_OPERATIONS_SERVICE_IDS,
  RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS,
} from '../src/lib/service-capabilities/runtime-governance-operations.ts';
import { CAPABILITY_GATES } from '../src/lib/service-capability-contract.ts';
import { reconcileServiceInventory } from '../src/lib/service-inventory.ts';
import { getServices } from '../src/lib/services-directory.ts';

test('runtime, governance, and operations evidence accounts for its canonical 24 services', () => {
  const ids = [...RUNTIME_GOVERNANCE_OPERATIONS_SERVICE_IDS];
  assert.equal(ids.length, 24);
  assert.equal(new Set(ids).size, ids.length);

  assert.deepEqual(
    [...ids].sort(),
    [
      'agent-worker',
      'app-worker',
      'chat-worker',
      'cloudflared',
      'console',
      'edge-gateway',
      'fleet-forwarder',
      'fleetdm',
      'gateway',
      'gateway-control',
      'keycloak',
      'landing',
      'litellm',
      'litellm-forwarder',
      'llm-guard',
      'observability-forwarder',
      'opa',
      'openbao',
      'presidio',
      'redis',
      'status-page',
      'superset',
      'temporal',
      'unleash',
    ].sort(),
  );

  const directoryIds = new Set(getServices().map((service) => service.id));
  for (const id of ids)
    assert.ok(directoryIds.has(id), `${id} must exist in the 43-entry directory`);

  const selected = reconcileServiceInventory({ platformServices: getServices() }).entries.filter(
    (entry) => ids.includes(entry.id as (typeof ids)[number]),
  );
  assert.deepEqual(
    Object.fromEntries(
      ['runtime', 'governance', 'operations'].map((family) => [
        family,
        selected.filter((entry) => entry.family === family).length,
      ]),
    ),
    { runtime: 7, governance: 6, operations: 11 },
  );

  assert.equal(RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.length, 13);
  assert.equal(RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS.length, 11);
});

test('app-worker has a pinned six-item denominator without inflating live proof', () => {
  const audit = RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.find(
    (record) => record.serviceId === 'app-worker',
  );
  assert.ok(audit);
  assert.equal(audit.auditState, 'current');
  assert.equal(audit.auditStateEvidence, null);
  assert.match(audit.upstreamVersion, /21bd2f1a/);
  assert.match(audit.upstreamVersion, /@temporalio\/worker 1\.20\.2/);
  assert.match(audit.versionSource, /3e91d5d3/);
  assert.deepEqual(
    audit.items.map((item) => item.id),
    [
      'artifact-identity',
      'task-queue-readiness',
      'governed-step-execution',
      'human-pause-resume',
      'failure-recovery',
      'output-persistence',
    ],
  );
  assert.deepEqual(
    Object.fromEntries(
      audit.items.map((item) => [
        item.id,
        [
          item.gates.upstream.status,
          item.gates.adapter.status,
          item.gates.ui.status,
          item.gates.workflow.status,
        ],
      ]),
    ),
    {
      'artifact-identity': ['yes', 'partial', 'no', 'no'],
      'task-queue-readiness': ['yes', 'partial', 'partial', 'no'],
      'governed-step-execution': ['yes', 'yes', 'yes', 'no'],
      'human-pause-resume': ['yes', 'yes', 'yes', 'no'],
      'failure-recovery': ['yes', 'partial', 'partial', 'no'],
      'output-persistence': ['yes', 'partial', 'yes', 'no'],
    },
  );
  assert.ok(
    audit.items.every((item) => item.gates.workflow.status === 'no'),
    'code-path evidence must not masquerade as a production app-worker workflow',
  );
});

test('audited services have version evidence and honest item-level four-gate evidence', () => {
  for (const audit of RUNTIME_GOVERNANCE_OPERATIONS_AUDITS) {
    assert.ok(audit.upstreamVersion.trim(), `${audit.serviceId} must name a version`);
    assert.ok(audit.versionSource.trim(), `${audit.serviceId} must name the version source`);
    assert.ok(audit.denominatorSource.trim(), `${audit.serviceId} must name a denominator source`);
    assert.ok(audit.items.length > 0, `${audit.serviceId} must have a non-empty denominator`);
    assert.equal(new Set(audit.items.map((item) => item.id)).size, audit.items.length);

    if (audit.auditState === 'stale') {
      assert.ok(audit.auditStateEvidence, `${audit.serviceId} stale evidence must explain why`);
    } else {
      assert.equal(audit.auditStateEvidence, null);
    }

    for (const item of audit.items) {
      for (const gate of CAPABILITY_GATES) {
        assert.ok(item.gates[gate].evidence.trim(), `${audit.serviceId}/${item.id}/${gate}`);
      }
      const hasGap = CAPABILITY_GATES.some((gate) => item.gates[gate].status !== 'yes');
      assert.equal(
        Boolean(item.gap.trim()),
        hasGap,
        `${audit.serviceId}/${item.id} gap must match incomplete evidence`,
      );
    }
  }
});

test('unaudited services do not masquerade as new denominators', () => {
  const audited = new Set(RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.map((record) => record.serviceId));
  for (const id of RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS) {
    assert.ok(!audited.has(id), `${id} must remain not audited`);
  }
});
