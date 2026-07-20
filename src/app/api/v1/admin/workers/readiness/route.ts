import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readWorkerReadiness } from '@/lib/adapters/worker-readiness';

export const dynamic = 'force-dynamic';

// Live durable-worker readiness: the real poller state of each Temporal task queue (offgrid-apps /
// -agents / -chat), probed via DescribeTaskQueue. Admin-only. The adapter never throws, so an
// unreachable cluster is a truthful `unreachable` verdict in the body, not a 500.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const summary = await readWorkerReadiness();
  return NextResponse.json({ object: 'worker-readiness', ...summary });
}
