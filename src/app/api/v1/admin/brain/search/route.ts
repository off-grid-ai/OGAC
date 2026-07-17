import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { searchDocuments } from '@/lib/brain';
import { askerFrom } from '@/lib/retrieval/acl';
import { normalizeFilter, normalizeMode, type RetrievalOptions } from '@/lib/retrieval/query';
import { currentOrgId } from '@/lib/tenancy';

// Semantic retrieval over the Brain — returns scored hits (the citation set).
//
// GET is the simple citation lookup (unchanged default: pure vector, no filter). Optional query
// params make it DEEP: `mode=hybrid` fuses keyword + vector, and `filter=<json>` narrows by
// metadata (e.g. filter={"must":[{"field":"source","match":"SOP · Claims"}]}).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const sp = new URL(req.url).searchParams;
  const q = sp.get('q')?.trim() ?? '';
  if (!q) {
    return NextResponse.json({ object: 'list', query: '', data: [] });
  }
  const mode = normalizeMode(sp.get('mode'));
  let filter: RetrievalOptions['filter'];
  const rawFilter = sp.get('filter');
  if (rawFilter) {
    try {
      filter = normalizeFilter(JSON.parse(rawFilter)) ?? undefined;
    } catch {
      return NextResponse.json({ error: 'filter must be valid JSON' }, { status: 400 });
    }
  }
  const asker = askerFrom({ email: gate.user.email, role: gate.user.role });
  const data = await searchDocuments(q, 5, { mode, filter, asker }, await currentOrgId());
  return NextResponse.json({ object: 'list', query: q, mode, data });
}

// POST — same retrieval with a structured body, for callers passing a richer typed filter.
// Body: { query: string, k?: number, mode?: 'vector'|'hybrid', filter?: MetaFilter }.
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
  const k = typeof b.k === 'number' && b.k > 0 && b.k <= 100 ? Math.floor(b.k) : 5;
  const mode = normalizeMode(b.mode);
  const filter = normalizeFilter(b.filter) ?? undefined;
  const asker = askerFrom({ email: gate.user.email, role: gate.user.role });
  const data = await searchDocuments(b.query, k, { mode, filter, asker }, await currentOrgId());
  return NextResponse.json({ object: 'list', query: b.query, mode, data });
}
