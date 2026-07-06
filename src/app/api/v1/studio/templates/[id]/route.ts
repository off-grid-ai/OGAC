import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { studioTemplates } from '@/db/schema';
import { requireUser } from '@/lib/authz';
import { parseTemplatePatch } from '@/lib/studio-template';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await db
    .delete(studioTemplates)
    .where(and(eq(studioTemplates.id, id), eq(studioTemplates.ownerId, gate.user.email ?? '')));
  return NextResponse.json({ ok: true });
}

// PATCH { title?, summary?, visibility?, published? } → edit an assistant in place. Publishing
// mints a shareable slug (/app/<slug>) on first publish and forces 'public' visibility. Only the
// owner may edit. Slug/visibility rules are the pure parseTemplatePatch helper.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const owner = gate.user.email ?? '';

  const [row] = await db
    .select({ slug: studioTemplates.slug, title: studioTemplates.title })
    .from(studioTemplates)
    .where(and(eq(studioTemplates.id, id), eq(studioTemplates.ownerId, owner)))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const patch = parseTemplatePatch(body, { slug: row.slug, title: row.title });
  if (!patch) return NextResponse.json({ error: 'title must not be blank' }, { status: 400 });

  await db
    .update(studioTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(studioTemplates.id, id), eq(studioTemplates.ownerId, owner)));
  return NextResponse.json({ ok: true });
}
