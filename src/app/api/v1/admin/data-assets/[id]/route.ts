import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteAsset, getAsset, updateAsset, type UpdateAssetInput } from '@/lib/data-catalog-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const asset = await getAsset(id, await currentOrgId());
  if (!asset) return NextResponse.json({ error: 'unknown data asset' }, { status: 404 });
  return NextResponse.json(asset);
}

// Pure: validate + build the partial asset-update patch from the request body. The one required
// field (name) is rejected when blank via an error result the handler maps to a 400 — otherwise a
// field is coerced only when present. Behavior-identical to the previous inline construction.
function buildAssetPatch(
  body: Record<string, unknown>,
): { ok: true; patch: UpdateAssetInput } | { ok: false; error: string } {
  const patch: UpdateAssetInput = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return { ok: false, error: 'name cannot be empty' };
    patch.name = name;
  }
  if (body.source !== undefined) patch.source = String(body.source).trim();
  if (body.connectorId !== undefined) patch.connectorId = body.connectorId ? String(body.connectorId) : null;
  if (body.domainId !== undefined) patch.domainId = body.domainId ? String(body.domainId) : null;
  if (body.kind !== undefined) patch.kind = String(body.kind);
  if (body.owner !== undefined) patch.owner = String(body.owner).trim();
  if (body.description !== undefined) patch.description = String(body.description).trim();
  if (body.rowCount !== undefined) {
    const n = Number(body.rowCount);
    patch.rowCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  if (body.freshnessSlaHours !== undefined) {
    const n = Number(body.freshnessSlaHours);
    patch.freshnessSlaHours = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  if (body.syncStatus !== undefined) patch.syncStatus = String(body.syncStatus);
  if (body.syncError !== undefined) patch.syncError = String(body.syncError);
  if (body.lastRefreshAt !== undefined) {
    if (body.lastRefreshAt === null) patch.lastRefreshAt = null;
    else {
      const d = new Date(String(body.lastRefreshAt));
      if (!Number.isNaN(d.getTime())) patch.lastRefreshAt = d;
    }
  }
  return { ok: true, patch };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const built = buildAssetPatch(body);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
  const patch = built.patch;

  const orgId = await currentOrgId();
  const updated = await updateAsset(id, patch, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown data asset' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'data-asset.update',
    resource: `data-asset:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const ok = await deleteAsset(id, orgId);
  if (!ok) return NextResponse.json({ error: 'unknown data asset' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'data-asset.delete',
    resource: `data-asset:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true });
}
