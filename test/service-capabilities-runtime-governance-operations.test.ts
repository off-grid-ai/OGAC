import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_GOVERNANCE_OPERATIONS_AUDITS,
  RUNTIME_GOVERNANCE_OPERATIONS_DELEGATED_SERVICE_IDS,
  RUNTIME_GOVERNANCE_OPERATIONS_SERVICE_IDS,
  RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS,
} from '../src/lib/service-capabilities/runtime-governance-operations.ts';
import { CAPABILITY_GATES } from '../src/lib/service-capability-contract.ts';
import { getServices } from '../src/lib/services-directory.ts';

test('runtime, governance, and operations evidence accounts for its 28 disjoint services', () => {
  const ids = [...RUNTIME_GOVERNANCE_OPERATIONS_SERVICE_IDS];
  assert.equal(ids.length, 28);
  assert.equal(new Set(ids).size, ids.length);

  const directoryIds = new Set(getServices().map((service) => service.id));
  for (const id of ids)
    assert.ok(directoryIds.has(id), `${id} must exist in the 43-entry directory`);

  assert.equal(RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.length, 13);
  assert.equal(RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS.length, 13);
  assert.deepEqual(RUNTIME_GOVERNANCE_OPERATIONS_DELEGATED_SERVICE_IDS, ['litellm', 'presidio']);
});

test('audited services have version evidence and honest item-level four-gate evidence', () => {
  for (const audit of RUNTIME_GOVERNANCE_OPERATIONS_AUDITS) {
    assert.ok(audit.upstreamVersion.trim(), `${audit.serviceId} must name a version`);
    assert.ok(audit.versionSource.trim(), `${audit.serviceId} must name the version source`);
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

test('unaudited and delegated services do not masquerade as new denominators', () => {
  const audited = new Set(RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.map((record) => record.serviceId));
  for (const id of RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS) {
    assert.ok(!audited.has(id), `${id} must remain not audited`);
  }
  for (const id of RUNTIME_GOVERNANCE_OPERATIONS_DELEGATED_SERVICE_IDS) {
    assert.ok(!audited.has(id), `${id} evidence must remain owned by the canonical legacy audit`);
  }
});
