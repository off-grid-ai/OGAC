import { NextResponse } from 'next/server';
import {
  AppValidationError,
  cloneApp,
  getApp,
  TemplateBindError,
} from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── POST /api/v1/admin/apps/[id]/clone — "Duplicate this app" (SOP reuse) ─────────────────────────
// Deep-clones an app into a fresh, private, unpublished app in the SAME org (a same-team duplicate).
// The clone rule (what carries over / resets, lineage) lives in app-clone.ts; this handler only
// authenticates, resolves the org, and maps store errors to honest status codes. Body is optional:
// { title? } overrides the derived "… (copy)" title.

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const source = await getApp(id, orgId);
  if (!source) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { title?: string } | null;
  const ownerId = gate.user.email ?? 'service@offgrid.local';

  try {
    const clone = await cloneApp(source, {
      orgId,
      ownerId,
      origin: 'clone',
      title: typeof body?.title === 'string' ? body.title : undefined,
    });
    auditFromSession(gate, orgId, {
      action: 'app.create',
      resource: `app:${clone.id}`,
      outcome: 'ok',
    });
    return NextResponse.json(clone, { status: 201 });
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
