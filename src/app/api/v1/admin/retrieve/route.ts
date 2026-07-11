import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { askerFrom } from '@/lib/retrieval/acl';
import { normalizeFilter, normalizeMode } from '@/lib/retrieval/query';
import { route } from '@/lib/retrieval/router';
import { currentOrgId } from '@/lib/tenancy';

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
  // Permissions-aware retrieval: the asker is the authenticated caller. Admins resolve to a
  // superuser Asker (sees everything — no regression); a non-admin principal gets ACL-filtered.
  const asker = askerFrom({ email: gate.user.email, role: gate.user.role });
  const hasOpts = 'mode' in b || 'filter' in b;
  const opts = hasOpts
    ? { mode: normalizeMode(b.mode), filter: normalizeFilter(b.filter) ?? undefined, asker }
    : { asker };
  const result = await route(b.query, k, opts);
  // Data action (Phase 4.11): who queried what. Resource is the detected intent(s) — never the raw
  // query text (which may carry sensitive terms). Best-effort.
  auditFromSession(gate, await currentOrgId(), {
    action: 'retrieval.query',
    resource: `retrieval:${result.decision?.intent?.join(',') || 'query'}`,
    outcome: 'ok',
  });
  return NextResponse.json(result);
}
