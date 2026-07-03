import { NextResponse } from 'next/server';
import { requireAdmin, requireUser } from '@/lib/authz';
import { getBaseline, resetBaseline } from '@/lib/observability-settings';

export const dynamic = 'force-dynamic';

// GET (any user) — current drift baseline marker. POST (admin) — reset the baseline to now.
export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ baseline: await getBaseline() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof b?.note === 'string' ? b.note.trim().slice(0, 500) : '';
  await resetBaseline(gate.user.email ?? '', note);
  return NextResponse.json({ ok: true }, { status: 201 });
}
