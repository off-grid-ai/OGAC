import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readEvalsView } from '@/lib/evals-view';

// Evals read-back — the normalized display model (aggregate pass/fail, overall pass-rate, per-suite
// rollup, recent runs newest-first). Thin: gate, then hand off to the reader + pure normalizer.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await readEvalsView());
}
