import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateDriftProject, type TrendGranularity } from '@/lib/evidently-monitoring';
import {
  deleteDriftProject,
  getDriftProjectDetail,
  updateDriftProject,
} from '@/lib/evidently-projects-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// One monitoring project + its DERIVED report history + drift-share trend (from retained runs).
// `?granularity=hour|day` buckets the trend. Org-scoped so a cross-tenant id resolves to 404.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const g = new URL(req.url).searchParams.get('granularity');
  const granularity: TrendGranularity = g === 'hour' ? 'hour' : 'day';
  const detail = await getDriftProjectDetail(id, await currentOrgId(), granularity);
  if (!detail) return NextResponse.json({ error: 'drift project not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const check = validateDriftProject({
    name: body?.name,
    description: body?.description,
    dataset: body?.dataset,
    driftThreshold: body?.driftThreshold,
  });
  if (!check.ok || !check.value) {
    return NextResponse.json({ error: check.errors.join('; '), errors: check.errors }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const updated = await updateDriftProject(id, orgId, check.value);
  if (!updated) return NextResponse.json({ error: 'drift project not found' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'drift.project.update',
    resource: `drift-project:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const ok = await deleteDriftProject(id, orgId);
  if (!ok) return NextResponse.json({ error: 'drift project not found' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'drift.project.delete',
    resource: `drift-project:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true, id });
}
