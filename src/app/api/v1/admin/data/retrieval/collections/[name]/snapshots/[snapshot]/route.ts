import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { qdrantSnapshots } from '@/lib/adapters/qdrant-snapshots';
import { validateCollectionName, validateSnapshotName } from '@/lib/qdrant-snapshots';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

function validateParams(name: string, snapshot: string): string | null {
  const c = validateCollectionName(name);
  if (!c.ok) return c.error ?? 'bad collection';
  const s = validateSnapshotName(snapshot);
  if (!s.ok) return s.error ?? 'bad snapshot';
  return null;
}

// GET → proxy the raw snapshot file back to the browser (download). Admin-only; viewer may download.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string; snapshot: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name, snapshot } = await params;
  const err = validateParams(name, snapshot);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  try {
    const upstream = await qdrantSnapshots.downloadSnapshot(name, snapshot);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `download failed (${upstream.status})` }, { status: 502 });
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${snapshot}"`,
        ...(upstream.headers.get('content-length')
          ? { 'content-length': upstream.headers.get('content-length')! }
          : {}),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// DELETE → remove a snapshot (governed, audited). Destructive: the backup is gone.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ name: string; snapshot: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name, snapshot } = await params;
  const err = validateParams(name, snapshot);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  try {
    await qdrantSnapshots.deleteSnapshot(name, snapshot);
    auditFromSession(gate, await currentOrgId(), {
      action: 'retrieval.snapshot.delete',
      resource: `collection:${name}/snapshot:${snapshot}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
