import assert from 'node:assert/strict';
import test from 'node:test';

import { RUNTIME_GOVERNANCE_OPERATIONS_AUDITS } from '../src/lib/service-capabilities/runtime-governance-operations.ts';

test('cloud egress DLP belongs to the gateway and reports its bounded, honest release gates', () => {
  const gateway = RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.find(
    (record) => record.serviceId === 'gateway',
  );
  const llmGuard = RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.find(
    (record) => record.serviceId === 'llm-guard',
  );
  assert.ok(gateway);
  assert.ok(llmGuard);

  const capability = gateway.items.find((item) => item.id === 'cloud-egress-dlp');
  assert.ok(capability);
  assert.equal(
    llmGuard.items.some((item) => item.id === capability.id),
    false,
  );
  assert.equal(capability.uiHref, '/governance/egress');
  assert.deepEqual(
    [
      capability.gates.upstream.status,
      capability.gates.adapter.status,
      capability.gates.ui.status,
      capability.gates.workflow.status,
    ],
    ['yes', 'partial', 'yes', 'yes'],
  );

  assert.match(capability.gates.upstream.evidence, /default-on/i);
  assert.match(capability.gates.upstream.evidence, /fail-closed/i);
  assert.match(capability.gates.upstream.evidence, /admin opt-out/i);
  assert.match(capability.gates.adapter.evidence, /before forwardToCloud/);
  assert.match(capability.gap, /only the chat\/stream cloud-model path/);
  assert.doesNotMatch(capability.gap, /DEFAULT_ORG/);
  assert.match(capability.gates.adapter.evidence, /current orgId/);
  assert.match(capability.gates.workflow.evidence, /org_bharat/);
  assert.match(capability.gates.workflow.evidence, /compat:openai\/gpt-4o-mini/);
  assert.match(capability.gates.workflow.evidence, /\[REDACTED_EMAIL_ADDRESS_3\]/);
  assert.match(capability.gates.workflow.evidence, /c5e8e01e1852da63a7094ca99745fb0830af7710/);
});
