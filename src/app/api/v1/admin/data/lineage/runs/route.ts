import { NextResponse } from 'next/server';
import { marquezLineageReader } from '@/lib/adapters/marquez-lineage';
import { requireAdmin } from '@/lib/authz';
import { validateRunQuery } from '@/lib/marquez-lineage';

export const dynamic = 'force-dynamic';

// GET ?namespace=<ns>&job=<job>[&limit=] — the FULL run history for one job: state, real timing
// (startedAt/endedAt/duration), the NominalTimeRunFacet business-time window, the run's input/output
// datasets, and which facets Marquez holds — plus summary stats. The audit backbone: which run
// produced a dataset, when, and whether it succeeded. Best-effort; envelope always returned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const params = new URL(req.url).searchParams;
  const v = validateRunQuery({ namespace: params.get('namespace'), job: params.get('job') });
  if (!v.ok || !v.value) return NextResponse.json({ error: v.error }, { status: 400 });
  const rawLimit = Number(params.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  return NextResponse.json(
    await marquezLineageReader.readRunHistory(v.value.namespace, v.value.job, limit),
  );
}
