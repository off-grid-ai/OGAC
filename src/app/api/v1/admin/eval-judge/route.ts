import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { loadJudgeRouting } from '@/lib/eval-judge-resolve';
import { seedJudgeForOrg } from '@/lib/eval-judge-seed';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → the currently-resolved AI-quality judge routing for the caller's org (agent→pipeline→gateway
// →model, per the governing invariant). Reports conformant:false when the chain isn't fully wired so
// operators can SEE the judge is on a bootstrap fallback rather than assuming it's governed.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const routing = await loadJudgeRouting(orgId);
  return NextResponse.json(routing);
}

// POST → (idempotently) seed the judge system agent + pipeline for the caller's org, bound to a real
// gateway, and return the resolved routing. This is the "make the judge hierarchy-conformant" action.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const result = await seedJudgeForOrg(orgId);
  return NextResponse.json(result, { status: result.seeded ? 200 : 409 });
}
