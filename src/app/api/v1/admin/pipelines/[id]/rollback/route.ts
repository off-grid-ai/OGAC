import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { rollbackToLastGood } from '@/lib/pipeline-release';
import type { RollbackReason } from '@/lib/rollback-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/pipelines/[id]/rollback — roll a pipeline back to its LAST-GOOD published
// version (M1 auto-rollback). Body (optional): { reason?: 'eval-gate-fail'|'drift-breach'|'manual',
// detail?: string }. Used by the operator (manual) AND by the drift/eval-breach detectors.
//
// Honest: when there is no prior published version, returns 409 with the reason and leaves the
// pipeline untouched — it never fabricates a rollback. The restore, its frozen `autorollback`
// snapshot, and the `pipeline.autorollback` audit are all handled by rollbackToLastGood.
const REASONS: readonly RollbackReason[] = ['eval-gate-fail', 'drift-breach', 'manual'];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const by = gate.user.email ?? 'service@offgrid.local';

  const body = (await req.json().catch(() => ({}))) as { reason?: string; detail?: string };
  const reason: RollbackReason = REASONS.includes(body.reason as RollbackReason)
    ? (body.reason as RollbackReason)
    : 'manual';

  const result = await rollbackToLastGood(id, reason, { orgId, by, detail: body.detail });
  if (!result.rolledBack) {
    const status = result.reason === 'unknown pipeline' ? 404 : 409;
    return NextResponse.json({ error: result.reason ?? 'rollback failed', rolledBack: false }, { status });
  }
  return NextResponse.json(result);
}
