import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { transitionPipeline } from '@/lib/pipeline-lifecycle';
import {
  type LifecycleAction,
  allowedTransitions,
  isLifecycleStatus,
} from '@/lib/pipeline-lifecycle-model';
import { getPipeline } from '@/lib/pipelines';
import { resolvePipelineRole } from '@/lib/pipeline-lifecycle';

export const dynamic = 'force-dynamic';

const ACTIONS: readonly LifecycleAction[] = [
  'promote',
  'withdraw',
  'approve',
  'reject',
  'deprecate',
  'revive',
];

function isAction(v: unknown): v is LifecycleAction {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v);
}

// POST /api/v1/admin/pipelines/[id]/lifecycle — perform a lifecycle transition (M2 promotion gate).
// Body: { action: 'promote'|'withdraw'|'approve'|'reject'|'deprecate'|'revive', override?: boolean }.
// Authorization is the PURE role×status matrix (not requireAdmin): an owner/team-editor may promote,
// ONLY an approver/admin may approve. `approve` runs THROUGH M1's release gate — a failing gate
// returns 422 (blocked) unless `override`. GET returns the actor's legal transitions for this pipeline.
//
// Gated with requireUser (any authenticated principal); the fine-grained decision is delegated to the
// resolved LifecycleRole, so a viewer with no ownership/membership gets an empty action set + a 403.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const pipeline = await getPipeline(id, orgId);
  if (!pipeline) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });

  const actor = { email: gate.user.email ?? '', role: gate.user.role };
  const role = await resolvePipelineRole(actor, pipeline, orgId);
  const status = isLifecycleStatus(pipeline.status) ? pipeline.status : 'draft';
  return NextResponse.json({
    status,
    role,
    transitions: allowedTransitions(status, role),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const body = (await req.json().catch(() => ({}))) as { action?: unknown; override?: unknown };
  if (!isAction(body.action)) {
    return NextResponse.json(
      { error: `action must be one of ${ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const actor = { email: gate.user.email ?? '', role: gate.user.role };
  const result = await transitionPipeline(id, body.action, actor, {
    orgId,
    override: body.override === true,
  });

  if (result.forbidden) {
    // Unknown pipeline vs. an illegal move for this actor — both refuse; 404 for missing, 403 else.
    const missing = result.reason === 'unknown pipeline';
    return NextResponse.json(
      { error: missing ? 'unknown pipeline' : 'forbidden', reason: result.reason },
      { status: missing ? 404 : 403 },
    );
  }
  if (result.blocked) {
    // approve → release gate failed. Honest 422 with the decision (mirrors the publish route).
    return NextResponse.json(
      { error: 'release gate failed', decision: result.gate?.decision, blocked: true },
      { status: 422 },
    );
  }
  return NextResponse.json({
    pipeline: result.pipeline,
    decision: result.gate?.decision ?? null,
    overridden: result.gate?.overridden ?? false,
  });
}
