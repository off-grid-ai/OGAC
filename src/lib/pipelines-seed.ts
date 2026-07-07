// PURE sample-pipeline specs for the seed (Gateways × Pipelines, the PIPELINE tier). ZERO I/O — just
// the canonical set of Indian BFSI pipelines every deployment starts with, as TEMPLATES, with STABLE
// ids so the seed is idempotent (createPipeline uses onConflictDoNothing on the id). The seed route
// loops these over each org and binds them to that org's seeded ON-PREM gateway.
//
// Each template declares a realistic routing leash (pii → local, restricted → block), a HARD data
// allowlist, and a policy/guardrail overlay. Availability/health is NOT decided here — that's the
// gateway's live probe. This file only declares the governance contract.
import { sampleGatewayId } from '@/lib/gateways-seed';
import type { PipelineRouting } from '@/lib/pipelines-policy';

export interface SamplePipelineSpec {
  /** Stable key — the idempotency root. Suffixed per-org by the seed so ids never collide. */
  key: string;
  name: string;
  description: string;
  /** Data-domain/class ids this pipeline may touch — the HARD ceiling. */
  dataAllowlist: string[];
  routing: PipelineRouting;
  policyOverlay: Record<string, unknown>;
  guardrailOverlay: Record<string, unknown>;
}

// A standard BFSI leash: PII stays on the box, anything classed `restricted` is blocked from egress,
// everything else may go local. Reused across the templates so the intent is legible + DRY.
function bfsiRouting(): PipelineRouting {
  return {
    egressAllowed: false, // on-prem-first: data does not leave by default
    rules: [
      {
        name: 'pii-local',
        priority: 10,
        attribute: 'data_class',
        operator: 'eq',
        value: 'pii',
        action: 'local',
        model: '',
        fallback: '',
        enabled: true,
      },
      {
        name: 'restricted-block',
        priority: 20,
        attribute: 'data_class',
        operator: 'eq',
        value: 'restricted',
        action: 'block',
        model: '',
        fallback: '',
        enabled: true,
      },
      {
        name: 'default-local',
        priority: 100,
        attribute: 'data_class',
        operator: 'neq',
        value: '__never__',
        action: 'local',
        model: '',
        fallback: '',
        enabled: true,
      },
    ],
  };
}

// Six Indian BFSI templates. dataAllowlist ids reference data-domains the org owns (PAN/IFSC/INR
// context). Overlays TIGHTEN org defaults (e.g. force PII masking on).
export const SAMPLE_PIPELINES: readonly SamplePipelineSpec[] = [
  {
    key: 'reimbursement-governance',
    name: 'Reimbursement Governance',
    description:
      'Governed model access for employee reimbursement claims — validates against policy limits, masks PAN/bank details, keeps everything on-prem.',
    dataAllowlist: ['employee-records', 'reimbursement-claims', 'expense-policy'],
    routing: bfsiRouting(),
    policyOverlay: { requireApprovalOverInr: { mode: 'locked', level: 'local' } },
    guardrailOverlay: { requirePiiMasking: { mode: 'locked', bool: true } },
  },
  {
    key: 'motor-claim-fnol',
    name: 'Motor-Claim FNOL',
    description:
      'First Notice of Loss intake for motor insurance claims — extracts claim details, cross-checks the policy, never lets policyholder PII leave the network.',
    dataAllowlist: ['motor-policies', 'claims-fnol', 'garage-network'],
    routing: bfsiRouting(),
    policyOverlay: {},
    guardrailOverlay: { requirePiiMasking: { mode: 'locked', bool: true } },
  },
  {
    key: 'loan-underwriting',
    name: 'Loan Underwriting',
    description:
      'Retail loan underwriting assistant — reads the applicant profile, CIBIL band, and income proofs; restricted credit-bureau data is blocked from any cloud model.',
    dataAllowlist: ['loan-applications', 'credit-bureau', 'income-proofs', 'kyc-records'],
    routing: bfsiRouting(),
    policyOverlay: { blockRestrictedEgress: { mode: 'locked', level: 'block' } },
    guardrailOverlay: { requirePiiMasking: { mode: 'locked', bool: true } },
  },
  {
    key: 'kyc-verification',
    name: 'KYC Verification',
    description:
      'KYC document verification — validates PAN, Aadhaar, and address proofs against the customer record; the strictest allowlist and mandatory masking.',
    dataAllowlist: ['kyc-records', 'customer-master'],
    routing: bfsiRouting(),
    policyOverlay: {},
    guardrailOverlay: { requirePiiMasking: { mode: 'locked', bool: true } },
  },
  {
    key: 'fraud-screening',
    name: 'Fraud Screening',
    description:
      'Transaction fraud screening — scores UPI/NEFT/IMPS transactions against behavioural patterns; transaction data stays on the box.',
    dataAllowlist: ['transactions', 'customer-master', 'fraud-signals'],
    routing: bfsiRouting(),
    policyOverlay: { blockRestrictedEgress: { mode: 'locked', level: 'block' } },
    guardrailOverlay: { requirePiiMasking: { mode: 'default', bool: true } },
  },
  {
    key: 'cross-sell-advisor',
    name: 'Cross-Sell Advisor',
    description:
      'Next-best-action advisor for relationship managers — suggests products from the customer holding pattern; aggregate insights only, individual PII masked.',
    dataAllowlist: ['customer-master', 'product-catalog', 'holdings'],
    routing: bfsiRouting(),
    policyOverlay: {},
    guardrailOverlay: { requirePiiMasking: { mode: 'default', bool: true } },
  },
] as const;

/** Build the stable id for a sample pipeline within an org. Deterministic ⇒ idempotent seed. */
export function samplePipelineId(orgId: string, key: string): string {
  return `pl_seed_${orgId}_${key}`;
}

export interface SeedPipelinePlan {
  id: string;
  name: string;
  description: string;
  gatewayId: string;
  dataAllowlist: string[];
  routing: PipelineRouting;
  policyOverlay: Record<string, unknown>;
  guardrailOverlay: Record<string, unknown>;
  isTemplate: boolean;
  status: string;
}

/** Resolve the concrete create-inputs (stable ids, bound to the org's seeded on-prem gateway) for one
 *  org. PURE — the seed route persists these. Templates are published so consumers can bind them. */
export function planSeedPipelines(orgId: string): SeedPipelinePlan[] {
  const gatewayId = sampleGatewayId(orgId, 'onprem-cluster');
  return SAMPLE_PIPELINES.map((s) => ({
    id: samplePipelineId(orgId, s.key),
    name: s.name,
    description: s.description,
    gatewayId,
    dataAllowlist: s.dataAllowlist,
    routing: s.routing,
    policyOverlay: s.policyOverlay,
    guardrailOverlay: s.guardrailOverlay,
    isTemplate: true,
    status: 'published',
  }));
}
