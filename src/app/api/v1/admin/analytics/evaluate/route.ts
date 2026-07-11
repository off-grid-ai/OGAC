import { NextResponse } from 'next/server';
import { evaluateRules } from '@/lib/analytics-rules';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// "Evaluate now" action — check each of the caller-org's alert rules against the CURRENT analytics
// snapshot and report firing/ok. GET so it's a cheap, side-effect-free read the UI can poll on demand.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await evaluateRules(await currentOrgId()) });
}
