import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { qdrantSnapshots } from '@/lib/adapters/qdrant-snapshots';
import { buildRecoverRequest, validateCollectionName } from '@/lib/qdrant-snapshots';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Restore (recover) a collection from a snapshot location. DESTRUCTIVE — snapshot data overwrites the
// live collection (priority=snapshot by default). Governed + audited.
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const v = validateCollectionName(name);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const shaped = buildRecoverRequest(body ?? {});
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });

  try {
    await qdrantSnapshots.recoverSnapshot(name, shaped.request);
    auditFromSession(gate, await currentOrgId(), {
      action: 'retrieval.snapshot.recover',
      resource: `collection:${name}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
