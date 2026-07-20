import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { runQaSweep } from '@/lib/qa/sweep';
import { currentOrgId } from '@/lib/tenancy';

// Scheduled Agent-QA sweep — run it on a cadence (cron / CI / scheduler) against this endpoint.
// Runs an offline eval + drift analysis, emits a `qa.sweep` span (alert on degraded=true), and
// returns the verdict. 200 when healthy, 503 when degraded — so a CI gate / monitor can react to
// the status code directly.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const sweep = await runQaSweep({ orgId: await currentOrgId() });
  return NextResponse.json(sweep, { status: sweep.degraded ? 503 : 200 });
}
