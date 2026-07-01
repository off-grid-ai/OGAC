import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { route } from '@/lib/retrieval/router';

// Route a query: detect intent → query the matching sources (KB / database / tool) → return
// fused, provenance-carrying hits. The "routing magic" as an API.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { query?: unknown } | null;
  if (!b || typeof b.query !== 'string' || !b.query.trim()) {
    return NextResponse.json({ error: 'query (string) required' }, { status: 400 });
  }
  return NextResponse.json(await route(b.query));
}
