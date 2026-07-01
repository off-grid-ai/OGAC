import { NextResponse } from 'next/server';
import { getEvals } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';

// Run an offline eval through the active evals adapter (golden default; promptfoo / Ragas when
// selected via OFFGRID_ADAPTER_EVALS). Each OSS adapter falls back to golden if its tool/sidecar
// is unavailable, so this always records a scored run.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await getEvals().run(), { status: 201 });
}
