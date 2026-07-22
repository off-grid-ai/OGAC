import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { isModelKind, serviceErrorMessage, serviceErrorStatus } from '@/lib/schema-model';
import { listModels } from '@/lib/schema-model-store';
import { createModelLive } from '@/lib/warehouse-model-service';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Analytical-model management surface: list every governed model for the org, and create a new one
// (validate → apply the CREATE DDL live to ClickHouse → record v1 with the exact DDL). Thin — the
// pure plan lives in schema-model.ts, the sequencing in warehouse-model-service.ts. Admin-gated;
// mutations audited.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const models = await listModels(org);
  return NextResponse.json({ models });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.name !== 'string' || !isModelKind(body.kind)) {
    return NextResponse.json({ error: 'name and a valid kind are required' }, { status: 400 });
  }
  const org = await currentOrgId();
  const result = await createModelLive(
    {
      name: body.name,
      kind: body.kind,
      database: typeof body.database === 'string' ? body.database : null,
      definition: (body.definition ?? {}) as Record<string, unknown>,
      note: typeof body.note === 'string' ? body.note : undefined,
    },
    org,
  );

  if (!result.ok) {
    auditFromSession(gate, org, {
      action: 'warehouse.model.create',
      resource: `warehouse:model ${body.name} rejected(${serviceErrorMessage(result)})`,
      outcome: 'blocked',
    });
    return NextResponse.json(
      { error: serviceErrorMessage(result), ...(result.kind === 'invalid' ? { errors: result.errors } : {}) },
      { status: serviceErrorStatus(result.kind) },
    );
  }

  auditFromSession(gate, org, {
    action: 'warehouse.model.create',
    resource: `warehouse:model ${result.value.id} (${result.value.name}) applied v1`,
    outcome: 'ok',
  });
  return NextResponse.json({ model: result.value }, { status: 201 });
}
