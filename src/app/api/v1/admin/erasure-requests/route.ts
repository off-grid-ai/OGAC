import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  listAssets,
  listClassifications,
  listErasureRequests,
  recordErasureRequest,
  toClassification,
} from '@/lib/data-catalog-store';
import { deriveAssetPosture } from '@/lib/data-classification';
import { resolveRtbfScope, type RtbfAsset } from '@/lib/data-rtbf';
import { planErasure, propagateErasure, summarizeErasure, type StepResult } from '@/lib/erasure';
import { executeErasureStep } from '@/lib/erasure-execute';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// RTBF / subject-erasure REQUESTS (M4). GET → the durable request records for the org. POST → run a
// full right-to-be-forgotten: resolve the cross-plane scope (console + warehouse + vector + lineage),
// EXECUTE the console-plane deletes now (reusing the DSAR planner + the shared ORG-CONFINED executor
// — DRY with /erasure), and RECORD the request as an auditable artifact with the resolved scope.
// RTBF cross-tenant (SECURITY #236 fix 3): the console-plane deletes are confined to the requesting
// org. Warehouse/vector/lineage purge is DEFERRED to the S2 data engine — the request honestly
// reports what ran vs. what waits.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listErasureRequests(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const subject = String(body?.subject ?? '').trim();
  if (!subject) return NextResponse.json({ error: 'subject (email/id) required' }, { status: 400 });
  const org = await currentOrgId();

  // Resolve the full cross-plane scope from the pure planner + the org's PII-bearing catalog assets.
  // The plan is org-confined (RTBF cross-tenant) so its console-plane DELETEs can't reach another org.
  const plan = planErasure(subject, org);
  const assets = await listAssets(org);
  const rtbfAssets: RtbfAsset[] = [];
  for (const a of assets) {
    const posture = deriveAssetPosture((await listClassifications(a.id, org)).map(toClassification));
    if (posture.hasPii) {
      rtbfAssets.push({ id: a.id, name: a.name, source: a.source, hasPii: true, piiTags: posture.piiTags });
    }
  }
  const scope = resolveRtbfScope(subject, rtbfAssets, plan);

  // Execute the console-plane steps now (dependents ordered before parents in the catalog).
  const results: StepResult[] = [];
  for (const step of plan.steps) results.push(await executeErasureStep(step));
  const report = summarizeErasure(plan.subject, results, plan.deferred);

  // Propagate to the external planes (vector index, data lake, device replicas) for REAL — each
  // configured target's delete runs now; unreachable ones are honestly deferred with a reason.
  const requestedBy = gate.user?.email ?? '';
  const propagation = await propagateErasure(plan.subject, requestedBy, org);

  // Record the durable, auditable request with the resolved scope + what ran (console + propagation).
  const record = await recordErasureRequest(
    {
      subject: plan.subject,
      status: report.status, // 'completed' | 'partial'
      erasedRows: report.erasedRows,
      requestedBy,
      completedAt: new Date(),
      scope: {
        consoleResults: report.results,
        deferredStores: report.deferred,
        crossPlane: scope.targets,
        immediateCount: scope.immediateCount,
        deferredCount: scope.deferredCount,
        propagated: propagation.propagated,
        propagationDeferred: propagation.deferred,
      },
    },
    org,
  );

  auditFromSession(gate, org, {
    action: 'data.erasure-request',
    resource: `subject:${plan.subject}`,
    outcome: report.status === 'completed' ? 'ok' : 'error',
  });

  return NextResponse.json({ request: record, report, scope, propagation }, { status: 201 });
}
