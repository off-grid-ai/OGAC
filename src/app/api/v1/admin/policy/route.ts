import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { type PolicyBundle, getOrgPolicy, pushPolicy } from '@/lib/store';

type PolicyPatch = Partial<Omit<PolicyBundle, 'version' | 'updatedAt'>>;

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await getOrgPolicy());
}

// Admin pushes a new policy down to the fleet (bumps the version; nodes converge on pull).
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const patch: PolicyPatch = {};
  if (typeof body?.egressAllowed === 'boolean') patch.egressAllowed = body.egressAllowed;
  if (Array.isArray(body?.guardrails)) patch.guardrails = body.guardrails;
  if (Array.isArray(body?.allowedModels)) patch.allowedModels = body.allowedModels;
  const pushed = await pushPolicy(patch);
  auditFromSession(gate, await currentOrgId(), {
    action: 'policy.change',
    resource: `policy:v${pushed.version}`,
    outcome: 'ok',
  });
  return NextResponse.json(pushed);
}
