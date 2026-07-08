import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { assetPosture, listAssets, listErasureRequests, recordErasureRequest } from '@/lib/data-catalog-store';
import { planErasure, summarizeErasure, type PlanStep, type StepResult } from '@/lib/erasure';
import { deriveAssetPosture } from '@/lib/data-classification';
import { resolveRtbfScope, type RtbfAsset } from '@/lib/data-rtbf';
import { toClassification, listClassifications } from '@/lib/data-catalog-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// RTBF / subject-erasure REQUESTS (M4). GET → the durable request records for the org. POST → run a
// full right-to-be-forgotten: resolve the cross-plane scope (console + warehouse + vector + lineage),
// EXECUTE the console-plane deletes now (reusing the DSAR planner), and RECORD the request as an
// auditable artifact with the resolved scope. Warehouse/vector/lineage purge is DEFERRED to the S2
// data engine — the request honestly reports what ran vs. what waits.

// Execute one console-plane plan step as a parameterized DELETE (identifiers are catalog constants,
// never user input; the subject value is always bound). Never throws — a failing step is captured.
async function executeStep(step: PlanStep): Promise<StepResult> {
  try {
    const res = (await db.execute(
      sql`DELETE FROM ${sql.raw(step.table)} WHERE ${sql.raw(step.column)} = ${step.value}`,
    )) as unknown as { rowCount?: number | null };
    return { store: step.store, table: step.table, deleted: res.rowCount ?? 0, error: null };
  } catch (e) {
    return {
      store: step.store,
      table: step.table,
      deleted: 0,
      error: e instanceof Error ? e.message : 'delete failed',
    };
  }
}

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
  const plan = planErasure(subject);
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
  for (const step of plan.steps) results.push(await executeStep(step));
  const report = summarizeErasure(plan.subject, results, plan.deferred);

  // Record the durable, auditable request with the resolved scope + what ran.
  const requestedBy = gate.user?.email ?? '';
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
      },
    },
    org,
  );

  auditFromSession(gate, org, {
    action: 'data.erasure-request',
    resource: `subject:${plan.subject}`,
    outcome: report.status === 'completed' ? 'ok' : 'error',
  });

  return NextResponse.json({ request: record, report, scope }, { status: 201 });
}
