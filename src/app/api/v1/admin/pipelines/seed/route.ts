import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { createPipeline, listPipelines } from '@/lib/pipelines';
import { planSeedPipelines } from '@/lib/pipelines-seed';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Seed the pipeline library (Gateways × Pipelines, the PIPELINE tier) ──────────────────────────
// POST /api/v1/admin/pipelines/seed — declare the sample Indian BFSI pipelines as TEMPLATES so the
// library isn't empty (Reimbursement Governance, Motor-Claim FNOL, Loan Underwriting, KYC, Fraud
// Screening, Cross-Sell Advisor). IDEMPOTENT via stable ids (pl_seed_<org>_<key> + onConflictDoNothing
// in the store). Seeds BOTH the caller's org AND the Bharat tenant ('org_bharat'), each bound to that
// org's seeded on-prem gateway. Run the GATEWAY seed first so the binding resolves.
const SEED_ORGS = ['org_bharat'] as const;

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const callerOrg = await currentOrgId();
  const orgs = Array.from(new Set<string>([callerOrg, ...SEED_ORGS]));
  const by = gate.user.email ?? 'service@offgrid.local';

  const result: Record<string, { created: string[]; present: string[] }> = {};
  for (const orgId of orgs) {
    const existing = new Set((await listPipelines(orgId)).map((p) => p.id));
    const created: string[] = [];
    const present: string[] = [];
    for (const plan of planSeedPipelines(orgId)) {
      if (existing.has(plan.id)) {
        present.push(plan.name);
        continue;
      }
      const p = await createPipeline(
        {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          gatewayId: plan.gatewayId,
          dataAllowlist: plan.dataAllowlist,
          routing: plan.routing,
          policyOverlay: plan.policyOverlay,
          guardrailOverlay: plan.guardrailOverlay,
          isTemplate: plan.isTemplate,
          status: plan.status,
        },
        by,
        orgId,
      );
      if (p.id === plan.id) created.push(plan.name);
      else present.push(plan.name);
    }
    result[orgId] = { created, present };
  }

  auditFromSession(gate, callerOrg, {
    action: 'pipeline.seed',
    resource: 'pipeline:sample-seed',
    outcome: 'ok',
  });

  return NextResponse.json({ ok: true, orgs: result });
}
