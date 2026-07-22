import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getSpendFinOpsView } from '@/lib/adapters/litellm-spend';
import { parseRange } from '@/lib/litellm-spend';

export const dynamic = 'force-dynamic';

// Spend attributed BY VIRTUAL KEY over the window (?range=). Alias-first identity; the raw key token
// is never surfaced (masked to last-4 in the pure layer).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const view = await getSpendFinOpsView(range);
  return NextResponse.json({ object: 'list', configured: view.configured, live: view.live, data: view.byKey });
}
