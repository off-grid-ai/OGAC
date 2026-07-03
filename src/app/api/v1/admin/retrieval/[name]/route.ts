import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteCollection } from '@/lib/retrieval-writer';

export const dynamic = 'force-dynamic';

// Delete a single Qdrant collection (`DELETE /collections/{name}`). Thin: the name is validated
// and the write shaped by the pure/writer layer, so a bad name is a clean 400 and an upstream
// failure a 502 with a message.
export async function DELETE(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await ctx.params;
  const out = await deleteCollection(decodeURIComponent(name));
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.httpStatus });
  return NextResponse.json({ object: 'collection', name: out.name, deleted: true });
}
