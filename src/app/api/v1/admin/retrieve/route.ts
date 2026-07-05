import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { route } from '@/lib/retrieval/router';
import { normalizeFilter, normalizeMode } from '@/lib/retrieval/query';

// Route a query: detect intent → query the matching sources (KB / database / tool) → return
// fused, provenance-carrying hits. The "routing magic" as an API. Optional `mode` ('vector' |
// 'hybrid') and `filter` (metadata predicate) are threaded down to the KB vector store; omitting
// them preserves today's exact behaviour.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as {
    query?: unknown;
    k?: unknown;
    mode?: unknown;
    filter?: unknown;
  } | null;
  if (!b || typeof b.query !== 'string' || !b.query.trim()) {
    return NextResponse.json({ error: 'query (string) required' }, { status: 400 });
  }
  const k = typeof b.k === 'number' && b.k > 0 && b.k <= 100 ? Math.floor(b.k) : 8;
  const hasOpts = 'mode' in b || 'filter' in b;
  const opts = hasOpts
    ? { mode: normalizeMode(b.mode), filter: normalizeFilter(b.filter) ?? undefined }
    : undefined;
  return NextResponse.json(await route(b.query, k, opts));
}
