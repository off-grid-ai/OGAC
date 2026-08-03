import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin, requireUser } from '@/lib/authz';
import { validateCover, type CoverWindow } from '@/lib/cover';
import { addCover, deleteCover, endCover, listCover } from '@/lib/cover-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Cover — who handles the queue while someone is away ─────────────────────────────────────────────
//
// There was no delegation, no out-of-office and no reassignment, so one person on leave meant their queue
// silently stalled. On this tenant that is not hypothetical: it is what the ten-day-old cases under
// "nobody has picked this up" actually were.
//
// GET    → every window (any signed-in role can SEE who is covering; that is the point of it).
// POST   → declare an absence and who covers it.
// PATCH  → end one early, which is the common case — someone comes back sooner than planned.
// DELETE → remove one entered by mistake.

/** Today as a plain day, in UTC, so a window means the same thing wherever it is read. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listCover(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Partial<CoverWindow> | null;

  const w: CoverWindow = {
    away: String(body?.away ?? '').trim(),
    coveredBy: String(body?.coveredBy ?? '').trim(),
    from: String(body?.from ?? '').trim(),
    until: String(body?.until ?? '').trim(),
    note: body?.note ? String(body.note).trim() : undefined,
  };
  const check = validateCover(w, today());
  if (!check.ok) {
    return NextResponse.json({ error: 'This cover cannot be saved.', reasons: check.errors }, { status: 400 });
  }

  const org = await currentOrgId();
  const rec = await addCover(w, gate.user?.email ?? '', org);
  auditFromSession(gate, org, {
    action: 'work.cover.created',
    resource: `cover:${rec.id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ cover: rec }, { status: 201 });
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = body?.id?.trim();
  if (!id) return NextResponse.json({ error: 'Which cover should end?' }, { status: 400 });
  const org = await currentOrgId();
  const ended = await endCover(id, today(), org);
  if (!ended) {
    // Honest about which of the two it is: an unknown id and an already-finished window are different
    // things, and telling someone "not found" for a window they can see would be a lie.
    return NextResponse.json(
      { error: 'That cover is unknown, or it had already ended.' },
      { status: 404 },
    );
  }
  auditFromSession(gate, org, { action: 'work.cover.ended', resource: `cover:${id}`, outcome: 'ok' });
  return NextResponse.json({ ok: true, endedOn: today() });
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const id = new URL(req.url).searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'Which cover should be removed?' }, { status: 400 });
  const org = await currentOrgId();
  const gone = await deleteCover(id, org);
  if (!gone) return NextResponse.json({ error: 'unknown cover' }, { status: 404 });
  auditFromSession(gate, org, { action: 'work.cover.deleted', resource: `cover:${id}`, outcome: 'ok' });
  return NextResponse.json({ ok: true });
}
