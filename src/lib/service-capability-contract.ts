/**
 * Pure contract shared by versioned service-capability audit families.
 *
 * Family registries own evidence records. The canonical projection imports those registries and
 * remains the only lookup owner. Keeping the record shape and item factory here prevents each
 * parallel audit lane from inventing another gate model.
 */

export const CAPABILITY_GATES = ['upstream', 'adapter', 'ui', 'workflow'] as const;

export type CapabilityGate = (typeof CAPABILITY_GATES)[number];
export type CapabilityGateStatus = 'yes' | 'partial' | 'no';

export const CAPABILITY_GATE_LABELS: Readonly<Record<CapabilityGate, string>> = {
  upstream: 'Available',
  adapter: 'Integrated',
  ui: 'UI exposed',
  workflow: 'Used in workflow',
};

export interface CapabilityGateAssessment {
  status: CapabilityGateStatus;
  evidence: string;
}

export interface ServiceCapabilityItem {
  id: string;
  name: string;
  summary: string;
  uiHref: string;
  uiLabel: string;
  gap: string;
  gates: Readonly<Record<CapabilityGate, CapabilityGateAssessment>>;
}

export interface ServiceCapabilityAudit {
  serviceId: string;
  serviceLabel: string;
  upstreamVersion: string;
  versionSource: string;
  auditedAt: string;
  auditState: 'current' | 'stale';
  auditStateEvidence: string | null;
  summary: string;
  items: readonly ServiceCapabilityItem[];
}

export interface AuditedCapabilitySummary {
  status: 'audited';
  auditState: ServiceCapabilityAudit['auditState'];
  verifiedGates: number;
  partialGates: number;
  totalGates: number;
  productionItems: number;
  totalItems: number;
}

export interface NotAuditedCapabilitySummary {
  status: 'not-audited';
}

export type ServiceCapabilitySummary = AuditedCapabilitySummary | NotAuditedCapabilitySummary;

export type CapabilityGateInput = readonly [
  CapabilityGateStatus,
  string,
  CapabilityGateStatus,
  string,
  CapabilityGateStatus,
  string,
  CapabilityGateStatus,
  string,
];

export function defineCapability(
  id: string,
  name: string,
  summary: string,
  uiHref: string,
  uiLabel: string,
  gap: string,
  input: CapabilityGateInput,
): ServiceCapabilityItem {
  return {
    id,
    name,
    summary,
    uiHref,
    uiLabel,
    gap,
    gates: {
      upstream: { status: input[0], evidence: input[1] },
      adapter: { status: input[2], evidence: input[3] },
      ui: { status: input[4], evidence: input[5] },
      workflow: { status: input[6], evidence: input[7] },
    },
  };
}
