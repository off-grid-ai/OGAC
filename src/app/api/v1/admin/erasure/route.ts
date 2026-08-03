import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { planErasure, summarizeErasure, type StepResult } from '@/lib/erasure';
import { executeErasureStep } from '@/lib/erasure-execute';
import { extractSubjects } from '@/lib/subject-index';
import { eraseSubjectFromChunks } from '@/lib/subject-index-store';
import { currentOrgId } from '@/lib/tenancy';

// DSAR / right-to-erasure. The erasure PLAN (which subject-bearing tables/columns to match, and HOW
// each is confined to the requesting org) is the pure planner in src/lib/erasure.ts; the org-confined
// DELETE is the shared executor in erasure-execute.ts (DRY: this + /erasure-requests use the one
// executor). RTBF cross-tenant (SECURITY #236 fix 3): every DELETE is org-confined by the plan's
// OrgScope, so an erasure under org A can never reach org B's rows. Stores needing seams owned by
// other agents (vector index, external lake, device replicas) are reported as `deferred`, never
// silently skipped.

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const subject = body?.subject as string | undefined;
  if (!subject?.trim()) {
    return NextResponse.json({ error: 'subject (email/id) required' }, { status: 400 });
  }

  // RTBF cross-tenant: the erasure is confined to the REQUESTING admin's org. The plan carries the
  // org into every step's confinement; a blank org yields an empty plan (fail-closed, never global).
  const orgId = await currentOrgId();
  const plan = planErasure(subject, orgId);
  // Execute steps sequentially: dependent rows are ordered before their parents in the catalog.
  const results: StepResult[] = [];
  for (const step of plan.steps) {
    results.push(await executeErasureStep(step));
  }
  const report = summarizeErasure(plan.subject, results, plan.deferred);

  // EMBEDDED COPIES — the half that did not exist. Retrieval chunks are deleted; run records are
  // redacted in place so the decision trail survives (see subject-index-store). Each result carries
  // `remaining`, re-queried AFTER the work, which is the proof the DPO actually needs.
  const typed = extractSubjects(subject);
  const searched = typed.length ? typed : [{ type: 'REFERENCE' as const, value: subject }];
  const embedded = [];
  for (const t of searched) {
    const r = await eraseSubjectFromChunks(orgId, t.type, t.value).catch(() => null);
    if (r && r.matched > 0) embedded.push({ type: t.type, ...r });
  }
  const embeddedRemaining = embedded.reduce((n, e) => n + e.remaining, 0);

  auditFromSession(gate, orgId, {
    action: 'data.erasure',
    resource: `subject:${plan.subject}`,
    outcome: report.status === 'completed' ? 'ok' : 'error',
  });

  return NextResponse.json({
    ...report,
    embedded,
    // A single honest verdict for the surface: the erasure is only proven when NOTHING is left, and a
    // deferred store means we cannot claim completeness whatever the row counts say.
    proven: embeddedRemaining === 0 && report.status === 'completed',
    embeddedRemaining,
  });
}
