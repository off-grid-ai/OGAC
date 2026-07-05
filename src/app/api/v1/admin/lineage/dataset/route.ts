import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readDataset } from '@/lib/marquez';

export const dynamic = 'force-dynamic';

// Admin dataset detail read — schema fields, tags, and OpenLineage facets for one dataset.
// GET ?namespace=<ns>&dataset=<ds>. Best-effort: readDataset never throws, so a
// { configured, data, error } envelope is always returned (data === null when absent/unreachable).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const namespace = url.searchParams.get('namespace') ?? '';
  const dataset = url.searchParams.get('dataset') ?? '';
  if (!namespace || !dataset) {
    return NextResponse.json({ error: 'namespace and dataset required' }, { status: 400 });
  }
  return NextResponse.json(await readDataset(namespace, dataset));
}
