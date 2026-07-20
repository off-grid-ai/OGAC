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

  assert.equal(RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.length, 15);
  assert.equal(RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS.length, 9);
});

test('LLM Guard has a pinned archived denominator without conflating Off Grid sharding', () => {
  const audit = RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.find(
    (record) => record.serviceId === 'llm-guard',
  );
  assert.ok(audit);
  assert.equal(audit.auditState, 'current');
  assert.equal(audit.auditStateEvidence, null);
  assert.match(audit.upstreamVersion, /0\.3\.16/);
  assert.match(audit.upstreamVersion, /32b14a4a/);
  assert.match(audit.upstreamVersion, /archived and unmaintained/);
  assert.match(audit.versionSource, /bc74d828/);
  assert.match(audit.denominatorSource, /input_scanners/);
  assert.match(audit.denominatorSource, /output_scanners/);
  assert.deepEqual(
    audit.items.map((item) => item.id),
    [
      'prompt-sanitization',
      'prompt-threat-scanning',
      'output-safety-quality',
      'scanner-policy-lifecycle',
      'api-auth-rate-limits',
      'availability-failure-policy',
      'telemetry',
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
      'prompt-sanitization': ['yes', 'yes', 'yes', 'no'],
      'prompt-threat-scanning': ['yes', 'partial', 'partial', 'partial'],
      'output-safety-quality': ['yes', 'no', 'partial', 'no'],
      'scanner-policy-lifecycle': ['yes', 'partial', 'partial', 'no'],
      'api-auth-rate-limits': ['yes', 'yes', 'no', 'partial'],
      'availability-failure-policy': ['yes', 'partial', 'partial', 'partial'],
      telemetry: ['yes', 'no', 'no', 'no'],
    },
  );
  assert.match(
    audit.items.find((item) => item.id === 'scanner-policy-lifecycle')?.gap ?? '',
    /scanners_suppress/,
  );
  assert.match(
    audit.items.find((item) => item.id === 'output-safety-quality')?.gap ?? '',
    /\/analyze\/output/,
  );
  assert.equal(
    audit.items.some((item) => item.summary.includes('shard')),
    false,
    'first-party sharding must not be described as an upstream capability',
  );
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
      // task-queue-readiness is fully proven live: a real DescribeTaskQueue poller probe, exposed on
      // the app-worker detail page, verified on the fleet 2026-07-20 (44550@offgrid-s1 on offgrid-apps).
      'task-queue-readiness': ['yes', 'yes', 'yes', 'yes'],
      // A live BFSI HITL run (apprun_f339b0ee) on the fleet 2026-07-20 proved these on the durable
      // worker: governed steps executed, durable pause→approve→resume→complete, output+provenance
      // persisted. human-pause-resume stays 'partial' (only the approve path was exercised, not reject).
      'governed-step-execution': ['yes', 'yes', 'yes', 'yes'],
      'human-pause-resume': ['yes', 'yes', 'yes', 'partial'],
      'failure-recovery': ['yes', 'partial', 'partial', 'no'],
      'output-persistence': ['yes', 'partial', 'yes', 'yes'],
    },
  );
  // The only app-worker capabilities WITHOUT any retained live run evidence keep workflow 'no':
  // immutable-artifact identity and interrupted-restart failure recovery.
  assert.deepEqual(
    audit.items
      .filter((item) => item.gates.workflow.status === 'no')
      .map((item) => item.id)
      .sort(),
    ['artifact-identity', 'failure-recovery'],
  );
});

test('stale common execution spine records name exact immutable-identity blockers', () => {
  const audits = new Map(
    RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.map((record) => [record.serviceId, record]),
  );
  const gateway = audits.get('gateway');
  const opa = audits.get('opa');
  assert.ok(gateway);
  assert.ok(opa);

  // temporal graduated to `current` on 2026-07-20 once its live image digests were locked in
  // SERVER_STATE.md; it is no longer part of the stale execution spine.
  const temporal = audits.get('temporal');
  assert.ok(temporal);
  assert.equal(temporal.auditState, 'current');

  for (const audit of [gateway, opa]) {
    assert.equal(audit.auditState, 'stale');
    assert.ok(audit.auditStateEvidence);
    assert.match(
      audit.auditStateEvidence,
      /(checksum|digest|Image ID|RepoDigest)/i,
      `${audit.serviceId} identifies the missing immutable runtime evidence`,
    );
  }

  assert.match(gateway.auditStateEvidence ?? '', /does not restart the aggregator/);
  assert.match(opa.auditStateEvidence ?? '', /OFFGRID_ADAPTER_POLICY=opa/);

  const gatewayGovernance = gateway.items.find((item) => item.id === 'request-governance');
  const opaDecisions = opa.items.find((item) => item.id === 'policy-decisions');
  const opaLifecycle = opa.items.find((item) => item.id === 'policy-lifecycle');
  assert.ok(gatewayGovernance);
  assert.ok(opaDecisions);
  assert.ok(opaLifecycle);
  assert.deepEqual(
    [gatewayGovernance.gates.adapter.status, gatewayGovernance.gates.workflow.status],
    ['partial', 'partial'],
  );
  assert.deepEqual(
    [opaDecisions.gates.adapter.status, opaDecisions.gates.workflow.status],
    ['partial', 'no'],
  );
  assert.equal(opaLifecycle.gates.workflow.status, 'no');
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
