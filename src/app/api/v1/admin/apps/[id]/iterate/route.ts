import { NextResponse } from 'next/server';
import { applyEditPlan, heuristicEditPlan } from '@/lib/app-edit';
import { validateAppSpec } from '@/lib/app-model';
import { getApp, updateApp } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/apps/<id>/iterate — CHANGE a governed workflow by describing the change.
//
// The north-star persona can already create an app from plain language; this closes the loop so they
// can also CHANGE one ("also post it to Slack", "add an approval before it sends") without opening
// the builder or touching structure.
//
// SOLID: thin handler. Interpretation + application are the PURE app-edit rules; this only loads,
// validates, persists and audits. `preview: true` returns the proposed change WITHOUT saving, so an
// author can see exactly what would happen before committing — the review step that makes an
// AI-authored edit safe.
//
// HONEST: the response always carries `changes` (what was applied, in plain language) and `gaps`
// (what could not be done and why). An instruction that maps to nothing changes nothing and says so.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { instruction?: unknown; preview?: unknown };
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) {
    return NextResponse.json({ error: 'instruction is required' }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const result = applyEditPlan(app, heuristicEditPlan(instruction, app));

  // Never persist a spec that would not validate — the author gets the reason instead of a broken app.
  const validation = validateAppSpec(result.spec);
  if (!validation.ok) {
    return NextResponse.json(
      { error: 'the requested change would make the app invalid', details: validation.errors, gaps: result.gaps },
      { status: 422 },
    );
  }

  const applied = result.changes.length > 0;
  if (body.preview === true || !applied) {
    return NextResponse.json({
      preview: true,
      applied: false,
      changes: result.changes,
      gaps: result.gaps,
      spec: result.spec,
    });
  }

  const saved = await updateApp(id, orgId, {
    title: result.spec.title,
    steps: result.spec.steps,
    edges: result.spec.edges,
  });
  auditFromSession(gate, orgId, {
    action: 'app.iterate',
    resource: `app:${id} ${result.changes.length} change(s)`,
    outcome: 'ok',
  });
  return NextResponse.json({
    preview: false,
    applied: true,
    changes: result.changes,
    gaps: result.gaps,
    spec: saved ?? result.spec,
  });
}
