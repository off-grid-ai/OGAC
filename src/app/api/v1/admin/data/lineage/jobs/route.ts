import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { marquezLineageReader } from '@/lib/adapters/marquez-lineage';

export const dynamic = 'force-dynamic';

// GET ?namespace=<ns> — list the jobs in a namespace (name, type, latest-run state + time) so the
// run-history view can offer a job picker. Best-effort; envelope always returned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const namespace = new URL(req.url).searchParams.get('namespace')?.trim() ?? '';
  if (!namespace) return NextResponse.json({ error: 'namespace required' }, { status: 400 });
  return NextResponse.json(await marquezLineageReader.listJobs(namespace));
}
