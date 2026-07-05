import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { managedSetRollout, UnleashRequiredError } from '@/lib/flags-manager';

// Set the gradual-rollout percentage (flexibleRollout strategy) for the active environment.
// Gradual rollout is an Unleash capability; without Unleash configured this returns 409.
// Body: { percent: 0-100 }
export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  const b = (await req.json().catch(() => null)) as { percent?: unknown } | null;
  if (!b || typeof b.percent !== 'number' || !Number.isFinite(b.percent)) {
    return NextResponse.json({ error: 'percent (0–100 number) required' }, { status: 400 });
  }
  try {
    const percent = await managedSetRollout(decodeURIComponent(key), b.percent);
    return NextResponse.json({ ok: true, percent });
  } catch (e) {
    if (e instanceof UnleashRequiredError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'failed to set rollout on Unleash' }, { status: 502 });
  }
}
