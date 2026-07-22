import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getSpendFinOpsView } from '@/lib/adapters/litellm-spend';
import { parseRange } from '@/lib/litellm-spend';

export const dynamic = 'force-dynamic';

// Gateway FinOps summary — cost/token/request attribution over LiteLLM's DB-backed spend store for a
// window (?range=24h|7d|30d). Returns totals, by-model + by-key rollups, a time series, and which
// optional LiteLLM aggregate endpoints the deployed version exposes. Honest on free models: spend $0.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const view = await getSpendFinOpsView(range);
  return NextResponse.json(view);
}
