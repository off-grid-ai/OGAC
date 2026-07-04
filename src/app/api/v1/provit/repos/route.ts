import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { provitRepos } from '@/db/schema';
import { requireUser } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// GET  /api/v1/provit/repos — list mapped repos (newest first).
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const rows = await db.select().from(provitRepos).orderBy(desc(provitRepos.mappedAt)).limit(200);
  return NextResponse.json({ repos: rows }, { headers: { 'cache-control': 'no-store' } });
}

// POST /api/v1/provit/repos — Provit pushes a mapped repo (feature map + test cases). Upserts by id.
export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const actor = (gate as { user?: { email?: string } }).user?.email ?? 'provit';

  const b = (await req.json().catch(() => null)) as
    | { id?: string; url?: string; counts?: { features?: number; testFiles?: number; screens?: number; cases?: number }; plan?: unknown; features?: unknown }
    | null;
  if (!b?.id || !b.url) return NextResponse.json({ error: 'id and url required' }, { status: 400 });

  const c = b.counts ?? {};
  const row = {
    id: b.id,
    url: b.url,
    features: c.features ?? 0,
    testFiles: c.testFiles ?? 0,
    screens: c.screens ?? 0,
    cases: c.cases ?? 0,
    plan: (b.plan ?? b.features ?? null) as object | null,
    mappedBy: actor,
    mappedAt: new Date(),
  };
  await db.insert(provitRepos).values(row).onConflictDoUpdate({
    target: provitRepos.id,
    set: { url: row.url, features: row.features, testFiles: row.testFiles, screens: row.screens, cases: row.cases, plan: row.plan, mappedBy: actor, mappedAt: row.mappedAt },
  });
  return NextResponse.json({ ok: true, id: b.id });
}
