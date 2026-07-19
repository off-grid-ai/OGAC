import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAPABILITY_GATES,
  capabilityCoveragePercent,
  getServiceCapabilityAudit,
  SERVICE_CAPABILITY_AUDITS,
  summarizeServiceCapabilityAudit,
  type AuditedCapabilitySummary,
} from '../src/lib/service-capability-map.ts';

const AUDITED_IDS = ['evidently', 'presidio', 'streaming', 'otel-collector', 'litellm'];

test('registry exhaustively names the five audited services and versions', () => {
  assert.deepEqual(
    SERVICE_CAPABILITY_AUDITS.map((audit) => audit.serviceId),
    AUDITED_IDS,
  );
  assert.deepEqual(
    SERVICE_CAPABILITY_AUDITS.map((audit) => audit.upstreamVersion),
    ['0.4.40', '2.2.356', '24.2.7', '0.116.0', 'main-stable (mutable image tag)'],
  );
  for (const audit of SERVICE_CAPABILITY_AUDITS) {
    assert.equal(audit.auditedAt, '2026-07-19');
    assert.ok(audit.items.length >= 7, `${audit.serviceId} has a real capability denominator`);
  }
});

test('every capability has four independent evidence gates, a real route, and a concrete gap', () => {
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

test('summary counts only verified yes gates and keeps partials separate', () => {
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

test('unmapped services are not audited, never represented as zero or full coverage', () => {
  assert.equal(getServiceCapabilityAudit('postgres'), null);
  assert.deepEqual(summarizeServiceCapabilityAudit('postgres'), { status: 'not-audited' });
  assert.deepEqual(summarizeServiceCapabilityAudit('does-not-exist'), { status: 'not-audited' });
});

test('coverage percentage is safe for an explicit empty audited denominator', () => {
  const empty: AuditedCapabilitySummary = {
    status: 'audited',
    verifiedGates: 0,
    partialGates: 0,
    totalGates: 0,
    productionItems: 0,
    totalItems: 0,
  };
  assert.equal(capabilityCoveragePercent(empty), 0);
});
