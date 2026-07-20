import { NextResponse } from 'next/server';
import { parseEditPatch } from '@/lib/agent-form';
import { findAppByAgentId } from '@/lib/apps-store';
import { requireAdmin } from '@/lib/authz';
import { isAgentPipelineBindingValid } from '@/lib/pipeline-run-glue';
import {
  deleteCustomAgent,
  getCustomAgent,
  setCustomAgentEnabled,
  updateCustomAgent,
} from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

async function ownedAgentConflict(id: string, orgId: string): Promise<NextResponse | null> {
  const app = await findAppByAgentId(id, orgId);
  return app
    ? NextResponse.json(
        {
          error: 'This runtime agent is owned by an app and must be managed through that app.',
          appId: app.id,
          canonical: `/api/v1/admin/apps/${app.id}`,
        },
        { status: 409 },
      )
    : null;
}

// PATCH { enabled } → toggle a user-authored agent. PUT { …fields } → edit it in place.
// DELETE → remove it. Built-in agents are not stored in the DB, so these only affect custom
// agents (404 otherwise).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  if (!(await getCustomAgent(id, orgId)))
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  const conflict = await ownedAgentConflict(id, orgId);
  if (conflict) return conflict;
  const b = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof b?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  }
  await setCustomAgentEnabled(id, b.enabled, orgId);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  if (!(await getCustomAgent(id, orgId)))
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  const conflict = await ownedAgentConflict(id, orgId);
  if (conflict) return conflict;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const patch = parseEditPatch(b);
  if (!patch) {
    return NextResponse.json(
      { error: 'name/instructions must not be blank; pipelineId must be a string or null' },
      { status: 400 },
    );
  }
  if (
    patch.pipelineId !== undefined &&
    !(await isAgentPipelineBindingValid(patch.pipelineId, orgId))
  ) {
    return NextResponse.json({ error: 'pipeline not found in this organisation' }, { status: 400 });
  }
  const updated = await updateCustomAgent(id, patch, orgId);
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  if (!(await getCustomAgent(id, orgId)))
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  const conflict = await ownedAgentConflict(id, orgId);
  if (conflict) return conflict;
  await deleteCustomAgent(id, orgId);
  return NextResponse.json({ ok: true });
}
