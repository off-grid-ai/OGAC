import { NextResponse } from 'next/server';
import { listWorkflowExecutions } from '@/lib/adapters/agentruntime';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// GET → Temporal-side workflow executions (the durable-execution view, distinct from the DB run
// records). Graceful: when Temporal is unconfigured/unreachable this returns an empty view with a
// `note` + configured/reachable flags — never a 5xx.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50') || 50, 1), 200);
  const view = await listWorkflowExecutions(limit);
  return NextResponse.json(view);
}
