import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { provitRuns, provitVerdicts } from '@/db/schema';
import { requireUser } from '@/lib/authz';
import { currentPrincipal, provitAbacAllows, resolvePushPrincipal, visibilityFilter } from '@/lib/provit-access';
import { degradeOn503 } from '@/lib/route-degrade';

export const dynamic = 'force-dynamic';

type Verdict = { range?: string; bad?: boolean; note?: string };

// GET /api/v1/provit/runs — runs the caller can access (ABAC + tenancy inherited).
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  return degradeOn503(async () => {
    const p = await currentPrincipal();
    if (!(await provitAbacAllows(p, 'read'))) return NextResponse.json({ runs: [] });
    const rows = await db.select().from(provitRuns).where(visibilityFilter(provitRuns, p)).orderBy(desc(provitRuns.ts)).limit(200);
    return NextResponse.json({ runs: rows }, { headers: { 'cache-control': 'no-store' } });
  });
}

// POST /api/v1/provit/runs — Provit pushes a completed run + MERGED judge verdicts. A pvt_ token
// attributes it to the issuer's org; otherwise the public demo library.
export async function POST(req: Request): Promise<Response> {
  const who = await resolvePushPrincipal(req);
  if (who instanceof NextResponse) return who;

  const b = (await req.json().catch(() => null)) as
    | { id?: string; repoId?: string; surface?: string; model?: string; direction?: string; headline?: string;
        frames?: number; flagged?: number; video?: string; narrative?: string; verdicts?: Verdict[]; payload?: unknown }
    | null;
  if (!b?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const run = {
    id: b.id, orgId: who.orgId, ownerId: who.ownerId, visibility: who.visibility,
    repoId: b.repoId ?? null, surface: b.surface ?? null, model: b.model ?? null,
    direction: b.direction ?? null, headline: b.headline ?? null,
    frames: b.frames ?? 0, flagged: b.flagged ?? 0, video: b.video ?? null, narrative: b.narrative ?? null,
    payload: (b.payload ?? null) as object | null, ts: new Date(),
  };
  return degradeOn503(async () => {
    await db.insert(provitRuns).values(run).onConflictDoUpdate({
      target: provitRuns.id,
      set: { orgId: run.orgId, ownerId: run.ownerId, visibility: run.visibility, repoId: run.repoId, surface: run.surface, model: run.model, direction: run.direction, headline: run.headline, frames: run.frames, flagged: run.flagged, video: run.video, narrative: run.narrative, payload: run.payload, ts: run.ts },
    });

    const verdicts = Array.isArray(b.verdicts) ? b.verdicts : [];
    for (let i = 0; i < verdicts.length; i++) {
      const v = verdicts[i];
      const row = { id: `${run.id}:${i}`, runId: run.id, idx: i, frameRange: v.range ?? null, bad: !!v.bad, note: v.note ?? null };
      await db.insert(provitVerdicts).values(row).onConflictDoUpdate({
        target: provitVerdicts.id, set: { frameRange: row.frameRange, bad: row.bad, note: row.note },
      });
    }
    return NextResponse.json({ ok: true, id: run.id, verdicts: verdicts.length, scope: who.visibility });
  });
}
