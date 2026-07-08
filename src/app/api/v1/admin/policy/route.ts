import { NextResponse } from 'next/server';
import { db } from '@/db';
import { fleetNodes } from '@/db/schema';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { fleetModelTags } from '@/lib/model-catalog';
import { sanitizeGuardrails, sanitizeModels } from '@/lib/policy-catalog';
import { currentOrgId } from '@/lib/tenancy';
import { type PolicyBundle, getOrgPolicy, pushPolicy } from '@/lib/store';

type PolicyPatch = Partial<Omit<PolicyBundle, 'version' | 'updatedAt'>>;

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await getOrgPolicy());
}

// Admin pushes a new policy down to the fleet (bumps the version; nodes converge on pull).
//
// Governance-integrity guard (T3): guardrails + allowed-models are SANITISED against the real value
// catalogs before they persist — only enforceable guardrail check-ids and routable model ids
// (MODEL_CATALOG ∪ live fleet tags) survive. An unknown/garbage value is DROPPED, never published
// org-wide. This is the server-side backstop behind the constrained PolicyEditor pickers.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);

  // Live fleet routing tags for the known-model union. DB down → catalog-only, still safe.
  const nodes = await db
    .select({ model: fleetNodes.model, role: fleetNodes.role })
    .from(fleetNodes)
    .catch(() => [] as { model: string; role: string }[]);
  const liveTags = fleetModelTags(nodes);

  const patch: PolicyPatch = {};
  if (typeof body?.egressAllowed === 'boolean') patch.egressAllowed = body.egressAllowed;
  if (Array.isArray(body?.guardrails)) {
    patch.guardrails = sanitizeGuardrails(body.guardrails.map((g: unknown) => String(g)));
  }
  if (Array.isArray(body?.allowedModels)) {
    patch.allowedModels = sanitizeModels(
      body.allowedModels.map((m: unknown) => String(m)),
      liveTags,
    );
  }
  const pushed = await pushPolicy(patch);
  auditFromSession(gate, await currentOrgId(), {
    action: 'policy.change',
    resource: `policy:v${pushed.version}`,
    outcome: 'ok',
  });
  return NextResponse.json(pushed);
}
