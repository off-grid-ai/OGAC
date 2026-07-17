import { NextResponse } from 'next/server';
import { deleteSchemaSubject } from '@/lib/adapters/redpanda';
import { requireAdmin } from '@/lib/authz';

export async function DELETE(req: Request, { params }: { params: Promise<{ subject: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { subject } = await params;
    return NextResponse.json(await deleteSchemaSubject(subject));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Schema delete failed' },
      { status: 400 },
    );
  }
}
