import { NextResponse } from 'next/server';
import {
  getApp,
  publishAppAsTemplate,
  TemplateVarSchemaError,
  unpublishTemplate,
} from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { parseTemplateVarSchema } from '@/lib/studio-template';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── /api/v1/admin/apps/[id]/publish-as-template — the SOP LIBRARY publish surface ─────────────────
// POST   → publish this multi-step app as a reusable org/public template carrying its {{var}} schema.
// DELETE → retract it from the library (keeps the app). Admin-gated, org-scoped, thin — the rule
// (schema validation, slug, visibility) lives in apps-store.publishAppAsTemplate; the untrusted var
// schema is shaped by the pure parseTemplateVarSchema so the parsing rule lives in one tested place.

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    vars?: unknown;
    visibility?: unknown;
  } | null;
  const varSchema = parseTemplateVarSchema(body?.vars);
  const visibility = body?.visibility === 'public' ? 'public' : 'org';

  try {
    const published = await publishAppAsTemplate(id, orgId, { varSchema, visibility });
    if (!published) return NextResponse.json({ error: 'not found' }, { status: 404 });
    auditFromSession(gate, orgId, {
      action: 'app.publish',
      resource: `template:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json(published);
  } catch (err) {
    if (err instanceof TemplateVarSchemaError) {
      return NextResponse.json({ error: err.message, errors: err.errors }, { status: 422 });
    }
    throw err;
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const retracted = await unpublishTemplate(id, orgId);
  if (!retracted) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'app.update',
    resource: `template:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(retracted);
}
