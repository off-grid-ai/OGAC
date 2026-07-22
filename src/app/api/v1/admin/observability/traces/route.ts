import { NextResponse, type NextRequest } from 'next/server';
import { getEntityObservability } from '@/lib/adapters/langfuse-entity';
import { requireUser } from '@/lib/authz';
import { resolveEntityMatch } from '@/lib/trace-entity';

export const dynamic = 'force-dynamic';

// Per-entity AI-observability list + rollups — the trace list, cost/latency/quality rollups for ONE
// entity (pipeline today), pulled from Langfuse and narrowed by the pure shaping layer. Read-only.
// Attribution is honest: an entity with no matching trace in the window returns a real-empty view.
//
//   GET /api/v1/admin/observability/traces?entity=<pipelineId>&kind=pipeline&range=7d
//
// `kind=pipeline` resolves the entity's match by its canonical `pipeline:<id>` tag AFTER verifying the
// pipeline exists in the caller's org (so a cross-tenant id 404s and can't read another org's traces).
export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const entity = (url.searchParams.get('entity') ?? '').trim();
  const kind = (url.searchParams.get('kind') ?? 'pipeline').trim();
  const range = url.searchParams.get('range') ?? undefined;
  if (!entity) return NextResponse.json({ error: 'entity is required' }, { status: 400 });

  const match = await resolveEntityMatch(kind, entity);
  if (!match) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const result = await getEntityObservability(match, range);
  return NextResponse.json(result);
}
