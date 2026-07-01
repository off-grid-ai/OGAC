import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { evaluateRouting } from '@/lib/store';

// Test where a request would route given its attributes (data_class, task, cost, …). The org
// egress switch is the master leash — a cloud decision with egress off is downgraded to block.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { attributes?: Record<string, string> } | null;
  const attributes = b?.attributes && typeof b.attributes === 'object' ? b.attributes : {};
  return NextResponse.json(await evaluateRouting({ attributes }));
}
