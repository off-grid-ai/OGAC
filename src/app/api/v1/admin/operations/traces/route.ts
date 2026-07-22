import { NextResponse } from 'next/server';
import { searchTraces } from '@/lib/adapters/jaeger';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Distributed-trace search over Jaeger's query API. Thin: authorize, parse the URL filters, delegate
// to the adapter (which delegates all shaping to the pure jaeger-trace layer). Honest {configured:false}
// when Jaeger isn't wired on this deployment.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const sp = new URL(req.url).searchParams;
  const service = (sp.get('service') ?? '').trim();
  if (!service) return NextResponse.json({ error: 'service is required' }, { status: 400 });

  const minRaw = Number(sp.get('minDuration') ?? '');
  const result = await searchTraces({
    service,
    operation: sp.get('operation'),
    range: sp.get('range'),
    minDurationMs: Number.isFinite(minRaw) ? minRaw : null,
    errorOnly: sp.get('errorOnly') === 'true',
    limit: Number(sp.get('limit') ?? '') || null,
    nowMs: Date.now(),
  });
  return NextResponse.json(result);
}
