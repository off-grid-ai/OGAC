import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createView, listViews, validateView } from '@/lib/analytics-rules';

export const dynamic = 'force-dynamic';

// Analytics saved views — named filter / time-range presets.
// GET (admin) → list views. POST (admin) → create a validated view.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listViews() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const raw = await req.json().catch(() => null);
  const v = validateView(raw);
  if (!v.valid || !v.value) return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  const view = await createView(v.value, gate.user.email ?? '');
  return NextResponse.json(view, { status: 201 });
}
