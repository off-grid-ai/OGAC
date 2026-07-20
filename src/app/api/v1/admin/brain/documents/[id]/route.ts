import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteDocument } from '@/lib/brain';
import { currentOrgId } from '@/lib/tenancy';

// Remove a document from the Brain knowledge base (LanceDB or Qdrant, per the active adapter).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteDocument(id, await currentOrgId());
  return NextResponse.json({ deleted: true });
}
