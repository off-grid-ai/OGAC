import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { provitRepos, provitRuns, provitVerdicts } from '@/db/schema';
import { requireUser } from '@/lib/authz';
import { currentPrincipal, provitAbacAllows, resolvePushPrincipal, visibilityFilter } from '@/lib/provit-access';
import { canDeleteRow } from '@/lib/provit-policy';
import { degradeOn503 } from '@/lib/route-degrade';

export const dynamic = 'force-dynamic';

// GET /api/v1/provit/repos — repos the caller can access (ABAC + tenancy inherited from console).
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  return degradeOn503(async () => {
    const p = await currentPrincipal();
    if (!(await provitAbacAllows(p, 'read'))) return NextResponse.json({ repos: [] });
    const rows = await db.select().from(provitRepos).where(visibilityFilter(provitRepos, p)).orderBy(desc(provitRepos.mappedAt)).limit(200);
    return NextResponse.json({ repos: rows }, { headers: { 'cache-control': 'no-store' } });
  });
}

// POST /api/v1/provit/repos — Provit pushes a mapped repo. A pvt_ integration token attributes it
// to the issuer's org (team data); otherwise it lands in the public demo library.
export async function POST(req: Request): Promise<Response> {
  const who = await resolvePushPrincipal(req);
  if (who instanceof NextResponse) return who;

  const b = (await req.json().catch(() => null)) as
    | { id?: string; url?: string; counts?: { features?: number; testFiles?: number; screens?: number; cases?: number }; plan?: unknown; features?: unknown }
    | null;
  if (!b?.id || !b.url) return NextResponse.json({ error: 'id and url required' }, { status: 400 });

  const c = b.counts ?? {};
  const row = {
    id: b.id, url: b.url,
    orgId: who.orgId, ownerId: who.ownerId, visibility: who.visibility,
    features: c.features ?? 0, testFiles: c.testFiles ?? 0, screens: c.screens ?? 0, cases: c.cases ?? 0,
    plan: (b.plan ?? b.features ?? null) as object | null, mappedBy: who.ownerId, mappedAt: new Date(),
  };
  return degradeOn503(async () => {
    await db.insert(provitRepos).values(row).onConflictDoUpdate({
      target: provitRepos.id,
      set: { url: row.url, orgId: row.orgId, ownerId: row.ownerId, visibility: row.visibility, features: row.features, testFiles: row.testFiles, screens: row.screens, cases: row.cases, plan: row.plan, mappedBy: row.mappedBy, mappedAt: row.mappedAt },
    });
    return NextResponse.json({ ok: true, id: b.id, scope: who.visibility });
  });
}

// DELETE /api/v1/provit/repos?id=… — remove a mapped repo the caller owns/administers (a
// console-owned entity), cascading its runs + verdicts. Deletion authority is the PURE
// `canDeleteRow` rule (owner of a private row, same-org member of an org row, or admin).
export async function DELETE(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  return degradeOn503(async () => {
    const p = await currentPrincipal();
    const [repo] = await db.select().from(provitRepos).where(eq(provitRepos.id, id)).limit(1);
    if (!repo) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!canDeleteRow(repo, { orgId: p.orgId, email: p.email, isAdmin: p.role === 'admin' })) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Cascade: verdicts of this repo's runs, then the runs, then the repo.
    const runs = await db.select({ id: provitRuns.id }).from(provitRuns).where(eq(provitRuns.repoId, id));
    for (const r of runs) await db.delete(provitVerdicts).where(eq(provitVerdicts.runId, r.id));
    await db.delete(provitRuns).where(eq(provitRuns.repoId, id));
    await db.delete(provitRepos).where(eq(provitRepos.id, id));
    return NextResponse.json({ deleted: true, id, runs: runs.length });
  });
}
