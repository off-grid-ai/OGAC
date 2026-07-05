import { NextResponse } from 'next/server';
import { describeWorkflow } from '@/lib/adapters/agentruntime';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// GET → a single Temporal workflow's status/result summary by workflowId. Graceful: not-found and
// unreachable are reported in the JSON (found:false + note), never as a thrown 5xx.
export async function GET(req: Request, { params }: { params: Promise<{ wf: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { wf } = await params;
  const detail = await describeWorkflow(decodeURIComponent(wf));
  return NextResponse.json(detail);
}
