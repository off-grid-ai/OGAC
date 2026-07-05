import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getThresholds, setThresholds } from '@/lib/presidio-recognizers';
import { currentOrgId } from '@/lib/tenancy';

// Per-org Presidio score thresholds. GET returns { global, perEntity }; PUT upserts them after
// normalization (clamped to [0,1], per-entity keys forced UPPER_SNAKE). The global floor rides on
// every /analyze request as `score_threshold`; per-entity floors are enforced locally after the
// analyzer responds. Thin: admin-gated, delegate to the lib.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await getThresholds(await currentOrgId()));
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  return NextResponse.json(await setThresholds(body, await currentOrgId()));
}
