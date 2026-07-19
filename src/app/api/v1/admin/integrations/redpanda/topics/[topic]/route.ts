import { NextResponse } from 'next/server';
import { deleteTopic, updateTopic } from '@/lib/adapters/redpanda';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

async function topicParam(params: Promise<{ topic: string }>) {
  return (await params).topic;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ topic: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const topic = await topicParam(params);
    const result = await updateTopic(topic, await req.json());
    const orgId = await currentOrgId();
    auditFromSession(gate, orgId, {
      action: 'stream.topic.update',
      resource: `redpanda-topic:${topic}`,
      outcome: 'ok',
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Topic update failed' },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ topic: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const topic = await topicParam(params);
    const body = (await req.json().catch(() => null)) as { confirmation?: unknown } | null;
    const result = await deleteTopic(topic, body?.confirmation);
    const orgId = await currentOrgId();
    auditFromSession(gate, orgId, {
      action: 'stream.topic.delete',
      resource: `redpanda-topic:${topic}`,
      outcome: 'ok',
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Topic delete failed' },
      { status: 400 },
    );
  }
}
