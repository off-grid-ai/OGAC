import { NextResponse } from 'next/server';
import { eq, or, desc } from 'drizzle-orm';
import { db } from '@/db';
import { studioTemplates } from '@/db/schema';
import { requireUser } from '@/lib/authz';
import type { Workflow } from '@/lib/studio';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const rows = await db
    .select()
    .from(studioTemplates)
    .where(or(eq(studioTemplates.ownerId, gate.user.email ?? ""), eq(studioTemplates.visibility, 'org')))
    .orderBy(desc(studioTemplates.updatedAt))
    .limit(50);
  return NextResponse.json({ templates: rows });
}

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json() as { title?: string; summary?: string; prompt?: string; workflow?: Workflow; visibility?: string };
  if (!body.title || !body.workflow) return NextResponse.json({ error: 'title and workflow required' }, { status: 400 });
  const id = `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(studioTemplates).values({
    id,
    ownerId: gate.user.email ?? "",
    title: body.title,
    summary: body.summary ?? '',
    prompt: body.prompt ?? '',
    workflow: body.workflow,
    visibility: body.visibility === 'org' ? 'org' : 'private',
  });
  return NextResponse.json({ id });
}
