import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { listAllRuns } from '@/lib/runs-monitor-reader';
import {
  filterRuns,
  paginate,
  parseKind,
  parseStatus,
  summarizeRuns,
} from '@/lib/runs-monitor';

export const dynamic = 'force-dynamic';

// ─── Unified Runs LIST route — Operations → Runs ──────────────────────────────────────────────────
// GET /api/v1/admin/runs?kind=&status=&q=&offset=&limit= → the merged app/agent/chat run list for
// the caller's org, normalized to one product-facing shape + vocabulary, newest first, paginated,
// with a status/kind summary for the header band. Admin-gated, org-scoped.
//
// SOLID: thin handler — auth, org, parse params, delegate to the thin reader (I/O) + the PURE
// runs-monitor aggregator (filter/paginate/summarize). No status logic here.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const orgId = await currentOrgId();
  const url = new URL(req.url);

  const kind = parseKind(url.searchParams.get('kind'));
  const status = parseStatus(url.searchParams.get('status'));
  const q = url.searchParams.get('q') ?? '';
  const offset = Number(url.searchParams.get('offset')) || 0;
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;

  const all = await listAllRuns(orgId);
  const summary = summarizeRuns(all);
  const filtered = filterRuns(all, { kind, status, q });
  const page = paginate(filtered, offset, limit);

  return NextResponse.json({
    object: 'list',
    data: page.rows,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
    summary,
  });
}
