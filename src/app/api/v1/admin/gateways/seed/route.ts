import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { createGateway, listGatewayRows } from '@/lib/gateways';
import { planSeedGateways } from '@/lib/gateways-seed';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Seed the gateway registry (Gateways × Pipelines, P1) ────────────────────────────────────────
// POST /api/v1/admin/gateways/seed — declare the sample gateways so the registry isn't empty:
// On-Prem Cluster (on-prem), OpenAI, Anthropic (cloud), OpenRouter (compat/cloud). IDEMPOTENT via
// stable ids (gw_seed_<org>_<key> + INSERT … ON CONFLICT DO NOTHING in the store). Seeds BOTH the
// caller's org AND the Bharat tenant ('org_bharat'), per the plan. Availability is NEVER seeded —
// it's merged from live probes at read time (OpenAI/Anthropic show unconfigured until keys are set).
const SEED_ORGS = ['org_bharat'] as const;

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const callerOrg = await currentOrgId();
  // De-dupe: always seed the caller's org + the Bharat tenant.
  const orgs = Array.from(new Set<string>([callerOrg, ...SEED_ORGS]));

  const result: Record<string, { created: string[]; present: string[] }> = {};
  for (const orgId of orgs) {
    const existing = new Set((await listGatewayRows(orgId)).map((g) => g.id));
    const created: string[] = [];
    const present: string[] = [];
    for (const plan of planSeedGateways(orgId)) {
      if (existing.has(plan.id)) {
        present.push(plan.name);
        continue;
      }
      const gw = await createGateway(
        {
          id: plan.id,
          name: plan.name,
          kind: plan.kind,
          baseUrl: plan.baseUrl,
          defaultModel: plan.defaultModel,
          egressClass: plan.egressClass,
          enabled: plan.enabled,
        },
        orgId,
      );
      // createGateway is idempotent (onConflictDoNothing) — count as created only if the id stuck.
      if (gw.id === plan.id) created.push(plan.name);
      else present.push(plan.name);
    }
    result[orgId] = { created, present };
  }

  auditFromSession(gate, callerOrg, {
    action: 'gateway.seed',
    resource: 'gateway:sample-seed',
    outcome: 'ok',
  });

  return NextResponse.json({ ok: true, orgs: result });
}
