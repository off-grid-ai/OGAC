import { NextResponse } from 'next/server';
import { deleteSchemaSubject, getSchemaSubject } from '@/lib/adapters/redpanda';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export async function DELETE(req: Request, { params }: { params: Promise<{ subject: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { subject } = await params;
    const body = (await req.json().catch(() => null)) as { confirmation?: unknown } | null;
    const result = await deleteSchemaSubject(subject, body?.confirmation);
    const orgId = await currentOrgId();
    auditFromSession(gate, orgId, {
      action: 'stream.schema-subject.delete',
      resource: `redpanda-schema:${subject}`,
      outcome: 'ok',
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Schema delete failed' },
      { status: 400 },
    );
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ subject: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { subject } = await params;
    return NextResponse.json(await getSchemaSubject(subject));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Schema read failed' },
      { status: 400 },
    );
  }
}
