import { NextResponse } from 'next/server';
import {
  AppValidationError,
  cloneApp,
  getTemplate,
  getTemplateSourceSpec,
  TemplateBindError,
} from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { parseProvidedVars } from '@/lib/studio-template';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── POST /api/v1/admin/apps/templates/[id]/use — "Use this template" (adoption) ───────────────────
// Instantiates a published template into the CALLER's org via the clone engine, binding the declared
// {{var}} values the adopter supplied on the form. Body: { values: { name: value }, title? }.
// Honest gaps (missing required / unbound / undeclared vars) come back 422 with the gap detail — the
// adoption NEVER lands a half-bound app. Thin: visibility + clone + bind rules all live in the store.
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const [template, source] = await Promise.all([
    getTemplate(id, orgId),
    getTemplateSourceSpec(id, orgId),
  ]);
  if (!template || !source) {
    return NextResponse.json({ error: 'template not found or not adoptable' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    values?: unknown;
    title?: unknown;
  } | null;
  const provided = parseProvidedVars(body?.values);
  const ownerId = gate.user.email ?? 'service@offgrid.local';

  try {
    const adopted = await cloneApp(source, {
      orgId,
      ownerId,
      origin: 'template',
      sourceTemplateId: id,
      title: typeof body?.title === 'string' ? body.title : undefined,
      varSchema: template.templateVars,
      provided,
    });
    auditFromSession(gate, orgId, {
      action: 'app.create',
      resource: `app:${adopted.id}`,
      outcome: 'ok',
    });
    return NextResponse.json(adopted, { status: 201 });
  } catch (err) {
    if (err instanceof TemplateBindError) {
      return NextResponse.json({ error: err.message, bind: err.bind }, { status: 422 });
    }
    if (err instanceof AppValidationError) {
      return NextResponse.json({ error: err.message, errors: err.errors }, { status: 422 });
    }
    throw err;
  }
}
