import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getApp } from '@/lib/apps-store';
import { newAppRunId, runApp } from '@/lib/app-run';

export const dynamic = 'force-dynamic';

// ─── App test-run route (Builder Epic Phase 3A — the INPUT screen's "Run") ────────────────────────
// POST /api/v1/admin/apps/[id]/run { input } → runs the saved AppSpec inline via the Phase 2A
// executor (runApp), collecting the per-step trace and the final outcome. This is the INLINE path
// the brief specifies: it calls runApp directly (does NOT import worker files); durable submit +
// the live-status screen land in later phases (2B/3-5). A `human` step pauses the inline run and it
// returns status 'awaiting_human' — the REVIEW screen (Phase 4) owns the resume.
//
// SOLID: thin handler — auth, org, load the spec, mint a run id, delegate to runApp. All execution
// logic is in app-run.ts (governed per-step pipeline).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { input?: Record<string, unknown> };
  const input = body.input && typeof body.input === 'object' ? body.input : {};

  const runId = newAppRunId();
  const outcome = await runApp(app, input, {
    orgId,
    actor: gate.user.email ?? undefined,
    runId,
  });

  auditFromSession(gate, orgId, {
    action: 'app.run',
    resource: `app:${id}`,
    outcome: outcome.status === 'error' ? 'error' : 'ok',
  });

  return NextResponse.json({ object: 'app_run', ...outcome });
}
