import { eq, or, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { studioTemplates } from '@/db/schema';
import { requireUser } from '@/lib/authz';
import { randomToken } from '@/lib/rand';
import type { Workflow } from '@/lib/studio';
import { slugFromTitle } from '@/lib/studio-template';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const rows = await db
    .select()
    .from(studioTemplates)
    .where(or(eq(studioTemplates.ownerId, gate.user.email ?? ''), eq(studioTemplates.visibility, 'org'), eq(studioTemplates.published, true)))
    .orderBy(desc(studioTemplates.updatedAt))
    .limit(50);
  return NextResponse.json({ templates: rows });
}

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json() as { title?: string; summary?: string; prompt?: string; workflow?: Workflow; visibility?: string; deploy?: boolean };
  if (!body.title || !body.workflow) return NextResponse.json({ error: 'title and workflow required' }, { status: 400 });
  const id = `st_${Date.now()}_${randomToken(6)}`;
  // Deploy (S2): publish as a shareable app at /app/<slug>. Slug from title + short suffix — reuse
  // the shared, tested slugFromTitle so the slug rule lives in one place (DRY).
  const slug = body.deploy ? slugFromTitle(body.title ?? 'app') : null;
  await db.insert(studioTemplates).values({
    id,
    ownerId: gate.user.email ?? '',
    title: body.title,
    summary: body.summary ?? '',
    prompt: body.prompt ?? '',
    workflow: body.workflow,
    visibility: body.deploy ? 'public' : body.visibility === 'org' ? 'org' : 'private',
    slug,
    published: !!body.deploy,
  });
  return NextResponse.json({ id, slug, url: slug ? `/app/${slug}` : null });
}
