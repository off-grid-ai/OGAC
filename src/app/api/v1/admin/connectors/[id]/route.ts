import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteConnector, updateConnector } from '@/lib/store';

const AUTHS = ['none', 'api-key', 'oauth'];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  if (body.auth !== undefined && !AUTHS.includes(body.auth as string)) {
    return NextResponse.json({ error: 'auth must be none | api-key | oauth' }, { status: 400 });
  }
  const updated = await updateConnector(id, {
    name: body.name as string | undefined,
    type: body.type as string | undefined,
    endpoint: body.endpoint as string | undefined,
    auth: body.auth as string | undefined,
    description: body.description as string | undefined,
  });
  if (!updated) return NextResponse.json({ error: 'unknown connector' }, { status: 404 });
  auditFromSession(gate, await currentOrgId(), {
    action: 'connector.update',
    resource: `connector:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteConnector(id);
  auditFromSession(gate, await currentOrgId(), {
    action: 'connector.delete',
    resource: `connector:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
