import { NextResponse } from 'next/server';
import { requireAdmin, requireUser } from '@/lib/authz';
import { createThreshold, listThresholds } from '@/lib/observability-settings';

export const dynamic = 'force-dynamic';

// GET (any user) — list alert threshold rules. POST (admin) — create a rule (validated).
export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listThresholds() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const r = await createThreshold(b ?? {}, gate.user.email ?? '');
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
}
