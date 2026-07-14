import { NextResponse } from 'next/server';
import { getAppBySlug } from '@/lib/apps-store';
import { requireUser } from '@/lib/authz';
import { cockpitRows } from '@/lib/cockpit-fixtures';
import {
  computeCockpitMetrics,
  formatInr,
  type CustomerRow,
} from '@/lib/cockpit-metrics';

export const dynamic = 'force-dynamic';

// ─── POST /api/v1/app/<slug>/cockpit-run — the Cross-Sell cockpit's governed run ──────────────────
//
// Computes next-best-actions over the customer book, honouring the run inputs (segment / region /
// minimum opportunity / focus). Deterministic and aggregate-only — no individual PII leaves the run.
// This is the RM-facing "generate my call list" action; it reads the book and ranks opportunities,
// so it returns a real, useful outcome every time (no dependency on a live model endpoint). Governed:
// a verified principal is required, same as every other run entry point.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) {
    return NextResponse.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
  }
  const { slug } = await params;
  const app = await getAppBySlug(slug);
  if (!app || !app.published) {
    return NextResponse.json({ status: 'error', error: 'app not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { input?: Record<string, unknown> };
  const input = body.input ?? {};
  const segment = str(input.segment);
  const region = str(input.region);
  const minPipeline = num(input.minPipeline);
  const focus = str(input.focus);

  const filtered = filterBook(cockpitRows(), { segment, region, minPipeline });
  if (filtered.length === 0) {
    return NextResponse.json({
      status: 'done',
      outcome: 'No opportunities match those filters. Widen the segment, region, or lower the minimum opportunity.',
    });
  }

  const metrics = computeCockpitMetrics(filtered);
  const top = metrics.topOpportunities.slice(0, 5);
  const scope = [segment && `${segment} segment`, region && region !== 'All India' ? region : '', focus && `focus: ${focus}`]
    .filter(Boolean)
    .join(' · ');

  const lines = [
    `Next-best-action — ${filtered.length} customers in scope${scope ? ` (${scope})` : ''}.`,
    `Open pipeline ${formatInr(metrics.kpi.pipelineValueInr)} · probability-weighted ${formatInr(metrics.kpi.expectedPipelineInr)}.`,
    '',
    'Call these first:',
    ...top.map(
      (o, i) =>
        `${i + 1}. ${o.segment}/${o.region} → offer ${o.nextBestProduct} — ${o.stage}, expected ${formatInr(o.expectedValueInr)}.`,
    ),
    '',
    'Aggregate insights only — individual customer PII is masked. Recommendations are governed on-prem.',
  ];

  return NextResponse.json({ status: 'done', outcome: lines.join('\n') });
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function filterBook(
  rows: CustomerRow[],
  f: { segment: string; region: string; minPipeline: number },
): CustomerRow[] {
  return rows.filter((r) => {
    if (f.segment && r.segment !== f.segment) return false;
    if (f.region && f.region !== 'All India' && r.region !== f.region) return false;
    if (f.minPipeline > 0 && r.opportunityInr < f.minPipeline) return false;
    return true;
  });
}
