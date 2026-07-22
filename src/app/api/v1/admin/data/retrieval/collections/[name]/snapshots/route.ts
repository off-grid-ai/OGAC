import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { qdrantSnapshots } from '@/lib/adapters/qdrant-snapshots';
import { validateCollectionName } from '@/lib/qdrant-snapshots';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// List / create snapshots for a collection. GET is a read (viewer allowed); POST creates a new
// snapshot (a governed, audited write — the backup action for disaster recovery).
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const v = validateCollectionName(name);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    return NextResponse.json({ snapshots: await qdrantSnapshots.listSnapshots(name) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const v = validateCollectionName(name);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const snapshot = await qdrantSnapshots.createSnapshot(name);
    auditFromSession(gate, await currentOrgId(), {
      action: 'retrieval.snapshot.create',
      resource: `collection:${name}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, snapshot }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
