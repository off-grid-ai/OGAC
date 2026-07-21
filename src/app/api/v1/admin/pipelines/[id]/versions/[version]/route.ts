import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateVersionLabel } from '@/lib/pipeline-version';
import { annotatePipelineVersion, getPipelineVersion } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// One version of a pipeline. Admin-gated, org-scoped, audited.
//   • GET   → the full frozen governance contract at that version (for the version detail view).
//   • PATCH → set/clear the operator label/annotation on that version. Body { label: string }.

function parseVersion(raw: string): number | null {
  const v = Number(raw);
  return Number.isInteger(v) && v > 0 ? v : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id, version } = await params;
  const v = parseVersion(version);
  if (v === null) return NextResponse.json({ error: 'invalid version' }, { status: 400 });
  const orgId = await currentOrgId();
  const found = await getPipelineVersion(id, v, orgId);
  if (!found) return NextResponse.json({ error: 'unknown version' }, { status: 404 });
  return NextResponse.json(found);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id, version } = await params;
  const v = parseVersion(version);
  if (v === null) return NextResponse.json({ error: 'invalid version' }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { label?: unknown } | null;
  const check = validateVersionLabel(body?.label);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const orgId = await currentOrgId();
  const updated = await annotatePipelineVersion(id, v, check.value, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown version' }, { status: 404 });

  auditFromSession(gate, orgId, {
    action: 'pipeline.version.annotate',
    resource: `pipeline:${id}:v${v}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}
