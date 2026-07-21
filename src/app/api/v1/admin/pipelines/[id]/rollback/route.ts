import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { rollbackToLastGood, rollbackToVersion } from '@/lib/pipeline-release';
import type { RollbackReason } from '@/lib/rollback-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/pipelines/[id]/rollback — roll a pipeline back to a prior version.
//   • Body { toVersion: number, detail? } → TARGETED rollback to the operator-chosen version
//     (rollbackToVersion). This is the manual, confirmed "promote a prior version back to active".
//   • Body { reason?: 'eval-gate-fail'|'drift-breach'|'manual', detail? } (no toVersion) → the
//     LAST-GOOD auto-rollback (rollbackToLastGood), used by the operator AND drift/eval detectors.
//
// Honest: when the target is invalid / there is no prior version, returns 409 with the reason and
// leaves the pipeline untouched — it never fabricates a rollback. The restore, its frozen snapshot,
// and the audit (`pipeline.rollback` / `pipeline.autorollback`) are handled by the lib.
const REASONS = new Set<RollbackReason>(['eval-gate-fail', 'drift-breach', 'manual']);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const by = gate.user.email ?? 'service@offgrid.local';

  const body = (await req.json().catch(() => ({}))) as {
    reason?: string;
    detail?: string;
    toVersion?: unknown;
  };

  // Targeted rollback to a specific chosen version.
  if (body.toVersion !== undefined) {
    const toVersion = Number(body.toVersion);
    if (!Number.isInteger(toVersion) || toVersion <= 0) {
      return NextResponse.json({ error: 'toVersion must be a positive integer' }, { status: 400 });
    }
    const targeted = await rollbackToVersion(id, toVersion, { orgId, by, detail: body.detail });
    if (!targeted.rolledBack) {
      const status = targeted.reason === 'unknown pipeline' ? 404 : 409;
      return NextResponse.json(
        { error: targeted.reason ?? 'rollback failed', rolledBack: false },
        { status },
      );
    }
    return NextResponse.json(targeted);
  }

  const reason: RollbackReason = REASONS.has(body.reason as RollbackReason)
    ? (body.reason as RollbackReason)
    : 'manual';

  const result = await rollbackToLastGood(id, reason, { orgId, by, detail: body.detail });
  if (!result.rolledBack) {
    const status = result.reason === 'unknown pipeline' ? 404 : 409;
    return NextResponse.json({ error: result.reason ?? 'rollback failed', rolledBack: false }, { status });
  }
  return NextResponse.json(result);
}
