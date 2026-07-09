import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  deleteArtifact,
  listArtifactVersions,
  revertArtifact,
  setArtifactPublished,
} from '@/lib/chat';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → version history for an owned artifact (newest first). Tenant-scoped: an artifact in another
// org resolves to null (404) so its history can't be read cross-tenant.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const versions = await listArtifactVersions(userId, await currentOrgId(), id);
  if (!versions) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ versions });
}

// PATCH → publish/unpublish or revert to a prior version. Both gated to the caller's current tenant.
// eslint-disable-next-line complexity
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const orgId = await currentOrgId();
  const body = await req.json().catch(() => ({}));

  if (typeof body.published === 'boolean') {
    const ok = await setArtifactPublished(userId, orgId, id, body.published);
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, published: body.published });
  }
  if (typeof body.revertTo === 'number') {
    const version = await revertArtifact(userId, orgId, id, body.revertTo);
    if (version === null) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, currentVersion: version });
  }
  return NextResponse.json({ error: 'published or revertTo required' }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  await deleteArtifact(userId, await currentOrgId(), id);
  return NextResponse.json({ ok: true });
}
