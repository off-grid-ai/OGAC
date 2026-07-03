import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { evaluateRules } from '@/lib/analytics-rules';

export const dynamic = 'force-dynamic';

// "Evaluate now" action — check each alert rule against the CURRENT analytics snapshot and report
// firing/ok. GET so it's a cheap, side-effect-free read the UI can poll on demand.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await evaluateRules() });
}
