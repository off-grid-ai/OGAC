import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateDriftProject } from '@/lib/evidently-monitoring';
import { createDriftProject, listDriftProjectsWithSignal } from '@/lib/evidently-projects-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Drift-monitoring PROJECTS collection — the console-owned system of record built on top of the
// retained drift runs. Admin-gated, org-scoped, audited. Pure validation in evidently-monitoring.ts;
// persistence + history/trend composition in evidently-projects-store.ts.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const data = await listDriftProjectsWithSignal(await currentOrgId());
  return NextResponse.json({ object: 'list', data });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
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
  const created = await createDriftProject(check.value, orgId);
  auditFromSession(gate, orgId, {
    action: 'drift.project.create',
    resource: `drift-project:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
