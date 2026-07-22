import { NextResponse, type NextRequest } from 'next/server';
import { getEntityTraceDetail } from '@/lib/adapters/langfuse-entity';
import { requireUser } from '@/lib/authz';
import { resolveEntityMatch } from '@/lib/trace-entity';

export const dynamic = 'force-dynamic';

// One trace's detail for an entity — the span/generation waterfall, models touched, and attached
// judge/eval scores. Verifies the trace belongs to the entity (else `belongs:false`) so one entity
// can't inspect another's trace.
//
//   GET /api/v1/admin/observability/traces/<traceId>?entity=<pipelineId>&kind=pipeline&range=7d
export async function GET(req: NextRequest, ctx: { params: Promise<{ traceId: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const { traceId } = await ctx.params;
  const url = new URL(req.url);
  const entity = (url.searchParams.get('entity') ?? '').trim();
  const kind = (url.searchParams.get('kind') ?? 'pipeline').trim();
  const range = url.searchParams.get('range') ?? undefined;
  if (!entity) return NextResponse.json({ error: 'entity is required' }, { status: 400 });

  const match = await resolveEntityMatch(kind, entity);
  if (!match) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const result = await getEntityTraceDetail(match, traceId, range);
  if (result.configured && !result.belongs) {
    return NextResponse.json({ error: 'trace not found for this entity' }, { status: 404 });
  }
  return NextResponse.json(result);
}
