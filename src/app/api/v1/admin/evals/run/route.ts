import { NextResponse } from 'next/server';
import { getEvals } from '@/lib/adapters/registry';

// Run an offline eval through the active evals adapter (golden default; promptfoo / Ragas when
// selected via OFFGRID_ADAPTER_EVALS). Each OSS adapter falls back to golden if its tool/sidecar
// is unavailable, so this always records a scored run.
export async function POST() {
  return NextResponse.json(await getEvals().run(), { status: 201 });
}
