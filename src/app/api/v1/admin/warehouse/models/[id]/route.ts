import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { serviceErrorMessage, serviceErrorStatus } from '@/lib/schema-model';
import { getModel } from '@/lib/schema-model-store';
import { deleteModelLive, editModelLive } from '@/lib/warehouse-model-service';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// A single governed analytical model: read its full version history + frozen DDL (GET), re-define
// its body as a NEW version applied live (PATCH), or drop it in ClickHouse + remove the store rows
// (DELETE). Thin over the pure plan + the service sequencing. Admin-gated; mutations audited.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const model = await getModel(id, org);
  if (!model) return NextResponse.json({ error: 'unknown model' }, { status: 404 });
  return NextResponse.json({ model });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.definition !== 'object' || body.definition === null) {
    return NextResponse.json({ error: 'a definition is required' }, { status: 400 });
  }
  const org = await currentOrgId();
  const result = await editModelLive(
    id,
    body.definition as Record<string, unknown>,
    typeof body.note === 'string' ? body.note : undefined,
    org,
  );
  if (!result.ok) {
    auditFromSession(gate, org, {
      action: 'warehouse.model.edit',
      resource: `warehouse:model ${id} rejected(${serviceErrorMessage(result)})`,
      outcome: 'blocked',
    });
    return NextResponse.json(
      { error: serviceErrorMessage(result), ...(result.kind === 'invalid' ? { errors: result.errors } : {}) },
      { status: serviceErrorStatus(result.kind) },
    );
  }
  auditFromSession(gate, org, {
    action: 'warehouse.model.edit',
    resource: `warehouse:model ${id} applied v${result.value.currentVersion}`,
    outcome: 'ok',
  });
  return NextResponse.json({ model: result.value });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const result = await deleteModelLive(id, org);
  if (!result.ok) {
    auditFromSession(gate, org, {
      action: 'warehouse.model.delete',
      resource: `warehouse:model ${id} rejected(${serviceErrorMessage(result)})`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: serviceErrorMessage(result) }, { status: serviceErrorStatus(result.kind) });
  }
  auditFromSession(gate, org, {
    action: 'warehouse.model.delete',
    resource: `warehouse:model ${id} (${result.value.name}) dropped`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, model: result.value });
}
