import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { studioTemplates } from '@/db/schema';
import { requireUser } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await db.delete(studioTemplates).where(and(eq(studioTemplates.id, id), eq(studioTemplates.ownerId, gate.user.email ?? "")));
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json() as { visibility?: string };
  if (body.visibility) {
    await db
      .update(studioTemplates)
      .set({ visibility: body.visibility === 'org' ? 'org' : 'private', updatedAt: new Date() })
      .where(and(eq(studioTemplates.id, id), eq(studioTemplates.ownerId, gate.user.email ?? "")));
  }
  return NextResponse.json({ ok: true });
}
