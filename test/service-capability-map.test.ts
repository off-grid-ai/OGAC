import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPABILITY_GATES,
  capabilityCoveragePercent,
  composeServiceCapabilityAudits,
  getServiceCapabilityAudit,
  SERVICE_CAPABILITY_AUDITS,
  summarizeServiceCapabilityAudit,
  type AuditedCapabilitySummary,
} from '../src/lib/service-capability-map.ts';

test('canonical registry composes 37 unique versioned audits without the removed product', () => {
  const ids = SERVICE_CAPABILITY_AUDITS.map((audit) => audit.serviceId);

  assert.equal(ids.length, 37);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.includes('provit'), false);
  for (const audit of SERVICE_CAPABILITY_AUDITS) {
    assert.ok(audit.upstreamVersion.trim(), `${audit.serviceId} has a version identity`);
    assert.ok(audit.versionSource.trim(), `${audit.serviceId} has deployment version evidence`);
    assert.ok(
      audit.denominatorSource.trim(),
      `${audit.serviceId} has a primary capability denominator source`,
    );
    assert.ok(audit.items.length > 0, `${audit.serviceId} has a bounded capability denominator`);
  }
});

test('composition rejects duplicate family ownership instead of silently choosing one record', () => {
  const audit = SERVICE_CAPABILITY_AUDITS[0];
  assert.ok(audit);
  assert.throws(
    () => composeServiceCapabilityAudits([[audit], [audit]]),
    new RegExp(`Duplicate service capability audit owner: ${audit.serviceId}`),
  );
});

test('stale audits cannot verify upstream availability', () => {
  const stale = SERVICE_CAPABILITY_AUDITS.filter((audit) => audit.auditState === 'stale');
  assert.ok(stale.length > 0);

  for (const audit of stale) {
    assert.ok(audit.auditStateEvidence, `${audit.serviceId} explains why its audit is stale`);
    assert.ok(audit.items.every((item) => item.gates.upstream.status === 'no'));
    assert.ok(audit.items.every((item) => item.gap.includes('Re-audit the deployed')));
    const summary = summarizeServiceCapabilityAudit(audit.serviceId);
    assert.equal(summary.status, 'audited');
    if (summary.status === 'audited') assert.equal(summary.auditState, 'stale');
  }
});

test('every capability has four independent evidence gates, a route, and an honest gap', () => {
  for (const audit of SERVICE_CAPABILITY_AUDITS) {
    const ids = new Set<string>();
    for (const item of audit.items) {
      assert.equal(ids.has(item.id), false, `${audit.serviceId}/${item.id} is unique`);
      ids.add(item.id);
      assert.match(item.uiHref, /^\//, `${audit.serviceId}/${item.id} links inside the console`);
      assert.ok(item.uiLabel.trim());
      assert.deepEqual(Object.keys(item.gates), CAPABILITY_GATES);
      for (const gate of CAPABILITY_GATES) {
        assert.match(item.gates[gate].status, /^(yes|partial|no)$/);
        assert.ok(item.gates[gate].evidence.trim(), `${audit.serviceId}/${item.id}/${gate}`);
      }
      const complete = CAPABILITY_GATES.every((gate) => item.gates[gate].status === 'yes');
      assert.equal(
        Boolean(item.gap.trim()),
        !complete,
        `${audit.serviceId}/${item.id} gap matches its four-gate state`,
      );
    }
  }
});

test('summary counts only verified gates and production workflow evidence', () => {
  const summary = summarizeServiceCapabilityAudit('litellm');
  assert.equal(summary.status, 'audited');
  if (summary.status !== 'audited') return;
  const audit = getServiceCapabilityAudit('litellm');
  assert.ok(audit);
  const assessments = audit.items.flatMap((item) =>
    CAPABILITY_GATES.map((gate) => item.gates[gate]),
  );
  assert.equal(
    summary.verifiedGates,
    assessments.filter((assessment) => assessment.status === 'yes').length,
  );
  assert.equal(
    summary.partialGates,
    assessments.filter((assessment) => assessment.status === 'partial').length,
  );
  assert.equal(summary.totalGates, audit.items.length * CAPABILITY_GATES.length);
  assert.equal(
    summary.productionItems,
    audit.items.filter((item) => item.gates.workflow.status === 'yes').length,
  );
  assert.equal(
    capabilityCoveragePercent(summary),
    Math.round((summary.verifiedGates / summary.totalGates) * 100),
  );
});

test('unaudited and unknown services stay unscored', () => {
  assert.equal(getServiceCapabilityAudit('edge-gateway'), null);
  assert.deepEqual(summarizeServiceCapabilityAudit('edge-gateway'), { status: 'not-audited' });
  assert.deepEqual(summarizeServiceCapabilityAudit('does-not-exist'), { status: 'not-audited' });
});

test('coverage percentage is safe for an explicit empty audited denominator', () => {
  const empty: AuditedCapabilitySummary = {
    status: 'audited',
    auditState: 'current',
    verifiedGates: 0,
    partialGates: 0,
    totalGates: 0,
    productionItems: 0,
    totalItems: 0,
  };
  assert.equal(capabilityCoveragePercent(empty), 0);
});
