import { NextResponse } from 'next/server';
import { deleteSchemaVersion } from '@/lib/adapters/redpanda';
import { requireAdmin } from '@/lib/authz';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ subject: string; version: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { subject, version } = await params;
    return NextResponse.json(await deleteSchemaVersion(subject, version));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Schema version delete failed' },
      { status: 400 },
    );
  }
}
