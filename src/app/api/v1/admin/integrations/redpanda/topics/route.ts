import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { createTopic } from '@/lib/adapters/redpanda';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await createTopic(await req.json());
    const orgId = await currentOrgId();
    auditFromSession(gate, orgId, {
      action: 'stream.topic.create',
      resource: `redpanda-topic:${result.topic.name}`,
      outcome: 'ok',
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Topic create failed' },
      { status: 400 },
    );
  }
}
