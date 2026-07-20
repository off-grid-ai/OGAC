/**
 * Canonical service-capability audit projection.
 *
 * Family modules own versioned evidence. This module composes them once, rejects duplicate service
 * ownership, normalizes stale availability, and exposes the lookup/summary API consumed by the
 * inventory and Console UI.
 */

import { DATA_QUALITY_OBSERVABILITY_AUDITS } from './service-capabilities/data-quality-observability';
import { RUNTIME_GOVERNANCE_OPERATIONS_AUDITS } from './service-capabilities/runtime-governance-operations';
import {
  CAPABILITY_GATES,
  type AuditedCapabilitySummary,
  type ServiceCapabilityAudit,
  type ServiceCapabilitySummary,
} from './service-capability-contract';

export {
  CAPABILITY_GATE_LABELS,
  CAPABILITY_GATES,
  defineCapability,
  type AuditedCapabilitySummary,
  type CapabilityGate,
  type CapabilityGateAssessment,
  type CapabilityGateInput,
  type CapabilityGateStatus,
  type NotAuditedCapabilitySummary,
  type ServiceCapabilityAudit,
  type ServiceCapabilityItem,
  type ServiceCapabilitySummary,
} from './service-capability-contract';

const REAUDIT_GAP =
  'Re-audit the deployed upstream denominator before treating availability as current.';

function normalizeAuditRecency(audit: ServiceCapabilityAudit): ServiceCapabilityAudit {
  if (audit.auditState !== 'stale' || !audit.auditStateEvidence) return audit;
  return {
    ...audit,
    summary: audit.summary.startsWith('Stale audit')
      ? audit.summary
      : `Stale audit - ${audit.auditStateEvidence} ${audit.summary}`,
    items: audit.items.map((item) => ({
      ...item,
      gap: item.gap.includes(REAUDIT_GAP)
        ? item.gap
        : `${REAUDIT_GAP}${item.gap ? ` ${item.gap}` : ''}`,
      gates: {
        ...item.gates,
        upstream: { status: 'no', evidence: audit.auditStateEvidence ?? REAUDIT_GAP },
      },
    })),
  };
}

export function composeServiceCapabilityAudits(
  families: readonly (readonly ServiceCapabilityAudit[])[],
): readonly ServiceCapabilityAudit[] {
  const audits = families.flat().map(normalizeAuditRecency);
  const ids = new Set<string>();
  for (const audit of audits) {
    if (ids.has(audit.serviceId)) {
      throw new Error(`Duplicate service capability audit owner: ${audit.serviceId}`);
    }
    ids.add(audit.serviceId);
  }
  return audits;
}

export const SERVICE_CAPABILITY_AUDITS = composeServiceCapabilityAudits([
  DATA_QUALITY_OBSERVABILITY_AUDITS,
  RUNTIME_GOVERNANCE_OPERATIONS_AUDITS,
]);

export function getServiceCapabilityAudit(serviceId: string): ServiceCapabilityAudit | null {
  return SERVICE_CAPABILITY_AUDITS.find((audit) => audit.serviceId === serviceId) ?? null;
}

export function summarizeServiceCapabilityAudit(serviceId: string): ServiceCapabilitySummary {
  const audit = getServiceCapabilityAudit(serviceId);
  if (!audit) return { status: 'not-audited' };

  const assessments = audit.items.flatMap((item) =>
    CAPABILITY_GATES.map((gate) => item.gates[gate]),
  );
  return {
    status: 'audited',
    auditState: audit.auditState,
    verifiedGates: assessments.filter((assessment) => assessment.status === 'yes').length,
    partialGates: assessments.filter((assessment) => assessment.status === 'partial').length,
    totalGates: assessments.length,
    productionItems: audit.items.filter((item) => item.gates.workflow.status === 'yes').length,
    totalItems: audit.items.length,
  };
}

export function capabilityCoveragePercent(summary: AuditedCapabilitySummary): number {
  if (summary.totalGates === 0) return 0;
  return Math.round((summary.verifiedGates / summary.totalGates) * 100);
}
