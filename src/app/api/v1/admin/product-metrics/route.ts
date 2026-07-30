import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { computeProductMetrics } from '@/lib/product-metrics-reader';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── §13 product success metrics ───────────────────────────────────────────────────────────────────
// GET /api/v1/admin/product-metrics?days=30
//
// roadmap-real.md §13 opens by rejecting the obvious measures — "OGAC should not be measured by prompts or
// model calls" — and asks instead for adoption, reuse, reliability, quality and governance. Auditing it found
// almost every metric DERIVABLE from data already recorded and almost none COMPUTED. This exposes the three
// groups that need no new instrumentation (reliability, reuse, governance).
//
// Thin by design: auth, org, window, delegate. All arithmetic is the pure product-metrics.ts (15 tests) and
// all I/O is product-metrics-reader.ts.
//
// A failed read returns 503 with `measured: false`, NOT a zeroed body. A dashboard that renders "0 successful
// runs" when the query failed is the failure-presenting-as-emptiness defect this codebase keeps producing —
// the caller has to be able to tell "we could not measure" from "the answer is zero". For the same reason
// every ratio inside carries `pct: null` rather than 0 when its denominator is empty.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const raw = Number(new URL(req.url).searchParams.get('days'));
  // Clamped, not trusted: an unbounded window would let a caller ask for a full-table scan.
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 365) : 30;

  const orgId = await currentOrgId();
  const metrics = await computeProductMetrics(orgId, days);
  if (!metrics) {
    return NextResponse.json(
      { object: 'product_metrics', measured: false, windowDays: days, error: 'metrics could not be computed' },
      { status: 503 },
    );
  }
  return NextResponse.json({ object: 'product_metrics', measured: true, windowDays: days, ...metrics });
}
