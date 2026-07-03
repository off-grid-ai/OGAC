import { NextResponse } from 'next/server';
import { getRecentRunsView } from '@/lib/agent-runs-store';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

// GET → recent agent/workflow runs + the computed timeline summary (status counts, per-run step
// totals, aggregate per-kind rollup). Read-back surface over the durable-execution history.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const view = await getRecentRunsView(25, await currentOrgId());
  return NextResponse.json({ object: 'agent_runs_view', ...view });
}
