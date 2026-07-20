import { NextResponse } from 'next/server';
import { runBfsiStreamJourney } from '@/lib/adapters/redpanda';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import type { BfsiStreamJourney } from '@/lib/redpanda-model';
import { currentOrgId } from '@/lib/tenancy';

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const body = (await req.json()) as { journey?: BfsiStreamJourney };
    const result = await runBfsiStreamJourney(body.journey as BfsiStreamJourney);
    const orgId = await currentOrgId();
    auditFromSession(gate, orgId, {
      action: 'stream.workflow.verify',
      resource: `redpanda-topic:${result.topic}`,
      outcome: 'ok',
      runId: result.eventId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Streaming workflow failed' },
      { status: 400 },
    );
  }
}
