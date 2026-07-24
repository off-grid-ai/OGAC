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

  assert.equal(RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.length, 24);
  assert.equal(RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS.length, 0);
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
      // prompt redaction proven live: /analyze/prompt redacts PAN→[REDACTED] + email→[REDACTED_EMAIL...]
      // (is_valid:false, Anonymize/Regex fired) + retained on governed run run_b542fcf7. Per-request
      // custom-recognizer reconfiguration is a scanner-policy-lifecycle concern, tracked there.
      'prompt-sanitization': ['yes', 'yes', 'yes', 'yes'],
      'prompt-threat-scanning': ['yes', 'partial', 'partial', 'partial'],
      // output scanning proven live: /analyze/output trips Toxicity:1 → is_valid:false; retained per
      // run (run_f7aa3cb5). workflow stays partial: no retained run where the output guard BLOCKS.
      'output-safety-quality': ['yes', 'yes', 'partial', 'partial'],
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
      // Each worker binds the deployed release SHA into its Temporal identity (<pid>@<host>#<sha8>);
      // DescribeTaskQueue reports it live and the readiness panel surfaces it (verified SHA 2b256bbc).
      'artifact-identity': ['yes', 'yes', 'yes', 'yes'],
      // task-queue-readiness is fully proven live: a real DescribeTaskQueue poller probe, exposed on
      // the app-worker detail page, verified on the fleet 2026-07-20 (44550@offgrid-s1 on offgrid-apps).
      'task-queue-readiness': ['yes', 'yes', 'yes', 'yes'],
      // A live BFSI HITL run (apprun_f339b0ee) on the fleet 2026-07-20 proved these on the durable
      // worker: governed steps executed, durable pause→approve→resume→complete, output+provenance
      // persisted. human-pause-resume stays 'partial' (only the approve path was exercised, not reject).
      'governed-step-execution': ['yes', 'yes', 'yes', 'yes'],
      // approve + reject both proven live via durable signal (apprun_f339b0ee / apprun_4440547c),
      // duplicate → 409; approve-authority covered by app-access tests.
      'human-pause-resume': ['yes', 'yes', 'yes', 'yes'],
      // worker-loss recovery proven live (apprun_fe17e9f5 survived kill+restart → resumed → done);
      // adapter/ui stay partial (safe-drain + build-compat + idempotency contract outstanding).
      'failure-recovery': ['yes', 'partial', 'partial', 'yes'],
      'output-persistence': ['yes', 'partial', 'yes', 'yes'],
    },
  );
  // The only app-worker capabilities WITHOUT any retained live run evidence keep workflow 'no':
  // immutable-artifact identity and interrupted-restart failure recovery.
  // Every app-worker capability now has at least a live workflow proof (worker-loss recovery for
  // failure-recovery landed 2026-07-21); none remain workflow:'no'.
  assert.deepEqual(
    audit.items.filter((item) => item.gates.workflow.status === 'no').map((item) => item.id),
    [],
  );
});

test('execution-spine immutable-identity blockers are all closed (gateway/opa/temporal current)', () => {
  const audits = new Map(
    RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.map((record) => [record.serviceId, record]),
  );
  const gateway = audits.get('gateway');
  const opa = audits.get('opa');
  assert.ok(gateway);
  assert.ok(opa);

  // The execution spine's immutable-identity blockers are all now CLOSED:
  // - temporal graduated 2026-07-20 (live image digests locked in SERVER_STATE.md);
  // - opa graduated 2026-07-23 (`opa version` → Build Commit 2ea031ea…);
  // - gateway graduated 2026-07-24 once its aggregator became a repo-owned root LaunchDaemon
  //   (co.getoffgridai.gateway-aggregator, launchd-managed, KeepAlive) with a PROVEN kill→auto-restart.
  const temporal = audits.get('temporal');
  assert.ok(temporal);
  assert.equal(temporal.auditState, 'current');
  assert.equal(opa.auditState, 'current');
  assert.equal(opa.auditStateEvidence, null);
  assert.match(opa.versionSource, /Build Commit 2ea031ea/);

  assert.equal(gateway.auditState, 'current');
  assert.equal(gateway.auditStateEvidence, null);
  assert.match(gateway.versionSource, /LaunchDaemon/);
  assert.match(gateway.versionSource, /Auto-restart PROVEN/);

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
  // OPA's capabilities are CLOSED + verified live (OFFGRID_ADAPTER_POLICY=opa; a live decision is
  // attributed engine:opa; Rego deploy/reload/rollback proven) — only its immutable image digest is
  // still unpinned, which is why auditState stays `stale` (see auditStateEvidence above). So the
  // capability gates are `yes`; the staleness is a provenance/digest axis, not a capability gap.
  assert.deepEqual(
    [opaDecisions.gates.adapter.status, opaDecisions.gates.workflow.status],
    ['yes', 'yes'],
  );
  assert.equal(opaLifecycle.gates.workflow.status, 'yes');
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
