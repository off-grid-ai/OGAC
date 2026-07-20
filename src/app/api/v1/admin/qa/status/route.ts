import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readQaStatus } from '@/lib/qa/status';
import { currentOrgId } from '@/lib/tenancy';

// Agent-QA summary — one call that answers "are the agents still doing a good job?": the latest
// offline eval score, the drift/degradation verdict, and whether online scoring is live. Drives
// the Agent QA dashboard and is the single endpoint a monitor can poll.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await readQaStatus(await currentOrgId()));
}
