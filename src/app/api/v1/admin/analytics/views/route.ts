import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createView, listViews, validateView } from '@/lib/analytics-rules';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Analytics saved views — named filter / time-range presets, scoped to the caller's org.
// GET (admin) → list this tenant's views. POST (admin) → create a validated view for it.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listViews(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const raw = await req.json().catch(() => null);
  const v = validateView(raw);
  if (!v.valid || !v.value) return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  const view = await createView(v.value, gate.user.email ?? '', await currentOrgId());
  return NextResponse.json(view, { status: 201 });
}
