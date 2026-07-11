import { NextResponse } from 'next/server';
import {
  AppValidationError,
  createApp,
  listApps,
  type AppSpecInput,
} from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── App collection routes (Builder Epic Phase 3A, task #108) ─────────────────────────────────────
// Thin admin-gated, org-scoped handlers over apps-store. All validation lives in the store
// (validateAppSpec); the route only authenticates, resolves the org, shapes the AppSpecInput, and
// maps a validation failure to a 422 with the honest error list.

// GET /api/v1/admin/apps → list every app in the caller's org (newest first).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listApps(orgId) });
}

// POST /api/v1/admin/apps → create an app from an AppSpec (the builder's "Looks good — save").
// Body is the mutable slice of an AppSpec: { title, summary, visibility, trigger, inputForm, steps,
// edges, published?, slug? }. Ownership is the caller; the store mints the id + re-validates.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as Partial<AppSpecInput> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'a JSON app spec body is required' }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const ownerId = gate.user.email ?? 'service@offgrid.local';
  const input: AppSpecInput = {
    title: String(body.title ?? ''),
    summary: String(body.summary ?? ''),
    visibility: body.visibility ?? 'private',
    trigger: body.trigger ?? { kind: 'on-demand' },
    inputForm: body.inputForm,
    steps: body.steps ?? [],
    edges: body.edges ?? [],
    published: body.published,
    slug: body.slug,
    pipelineId: body.pipelineId ?? null,
  };

  try {
    const app = await createApp(orgId, ownerId, input);
    auditFromSession(gate, orgId, {
      action: 'app.create',
      resource: `app:${app.id}`,
      outcome: 'ok',
    });
    return NextResponse.json(app, { status: 201 });
  } catch (err) {
    if (err instanceof AppValidationError) {
      return NextResponse.json({ error: err.message, errors: err.errors }, { status: 422 });
    }
    throw err;
  }
}
