import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getSpendFinOpsView } from '@/lib/adapters/litellm-spend';
import { parseRange } from '@/lib/litellm-spend';

export const dynamic = 'force-dynamic';

// Spend attributed BY MODEL over the window (?range=). Sorted by spend, then tokens (the primary
// signal on free models where every spend is $0).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const view = await getSpendFinOpsView(range);
  return NextResponse.json({ object: 'list', configured: view.configured, live: view.live, data: view.byModel });
}
