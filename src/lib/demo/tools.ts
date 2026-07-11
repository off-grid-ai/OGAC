// Demo TOOLS persona data — PURE, zero I/O. Registered HTTP/MCP tools a tenant governs on the Tools
// surface, distinct per flavour. Bank: core-banking lookup + CIBIL score. Insurer: policy-admin
// lookup + claims DB. Plus a couple of catalog-style entries. The runner registers these via
// createTool (which mints random ids), so idempotency is by NAME: planTools filters out any tool
// whose name already exists for the org (mirrors the connector name-idempotency pattern).
import type { TenantProfile } from '@/lib/tour-demo-seed';

export type DemoToolPolicy = 'allow' | 'approval' | 'blocked';

export interface DemoToolSeed {
  name: string;
  type: 'http' | 'mcp';
  endpoint: string;
  description: string;
  policy: DemoToolPolicy;
}

// ── BANK tools (org_bharat) ──
export const BANK_TOOLS: readonly DemoToolSeed[] = [
  {
    name: 'Core Banking Lookup',
    type: 'http',
    endpoint: 'https://corebank.internal/api/v1/accounts/{account}',
    description: 'Read-only account + balance lookup against the core-banking system. Masks PAN/IFSC in responses.',
    policy: 'allow',
  },
  {
    name: 'CIBIL Score Check',
    type: 'http',
    endpoint: 'https://bureau.internal/cibil/score',
    description: 'Pull the applicant CIBIL score + summary bands for underwriting. Human-approval gated (bureau hit is logged).',
    policy: 'approval',
  },
  {
    name: 'NEFT/IMPS Status',
    type: 'mcp',
    endpoint: 'mcp://payments/neft-status',
    description: 'Look up the settlement/return status of an outward NEFT or IMPS transaction by UTR.',
    policy: 'allow',
  },
  {
    name: 'Sanctions Screening',
    type: 'http',
    endpoint: 'https://screening.internal/pep-uapa/check',
    description: 'Screen a name against PEP and UAPA watchlists during onboarding. Blocked from ad-hoc use — pipeline-only.',
    policy: 'blocked',
  },
];

// ── INSURER tools (org_suraksha) ──
export const INSURER_TOOLS: readonly DemoToolSeed[] = [
  {
    name: 'Policy Admin Lookup',
    type: 'http',
    endpoint: 'https://polad.internal/api/v1/policies/{policyNo}',
    description: 'Read-only policy status, in-force date and premium history from the policy-admin system.',
    policy: 'allow',
  },
  {
    name: 'Claims DB Query',
    type: 'mcp',
    endpoint: 'mcp://claims/register',
    description: 'Query the claims register for a claim, its documents and settlement state. Approval-gated for PII rows.',
    policy: 'approval',
  },
  {
    name: 'Premium Persistency Lookup',
    type: 'http',
    endpoint: 'https://polad.internal/api/v1/premiums/{policyNo}',
    description: 'Read the premium ledger + persistency band for a policy, to drive lapse/revival nudges.',
    policy: 'allow',
  },
  {
    name: 'YRT Rate Card',
    type: 'http',
    endpoint: 'https://actuarial.internal/yrt/rates',
    description: 'Fetch the Yearly Renewable Term rate card by age band and sum assured for underwriting. Pipeline-only.',
    policy: 'blocked',
  },
];

/** The tools for a tenant — bank vs insurer. */
export function toolsFor(profile: TenantProfile): readonly DemoToolSeed[] {
  return profile.flavour === 'bank' ? BANK_TOOLS : INSURER_TOOLS;
}

/**
 * Idempotent by NAME (case-insensitive): return only the tools whose name isn't already registered
 * for the org (createTool mints random ids, so name is the only stable idempotency key).
 */
export function planTools(
  specs: readonly DemoToolSeed[],
  existingNames: readonly string[],
): { toCreate: DemoToolSeed[]; present: DemoToolSeed[] } {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const toCreate: DemoToolSeed[] = [];
  const present: DemoToolSeed[] = [];
  for (const t of specs) (have.has(t.name.trim().toLowerCase()) ? present : toCreate).push(t);
  return { toCreate, present };
}
