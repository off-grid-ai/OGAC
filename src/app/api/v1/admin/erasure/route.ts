import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  planErasure,
  summarizeErasure,
  type PlanStep,
  type StepResult,
} from '@/lib/erasure';
import { currentOrgId } from '@/lib/tenancy';

// DSAR / right-to-erasure. The erasure PLAN (which subject-bearing tables/columns to match) is the
// pure planner in src/lib/erasure.ts. This route EXECUTES that plan against the tables the console
// owns, through its own drizzle handle — real cross-store propagation, not a queued stub. Stores
// that need seams owned by the store/schema agent (vector index, external lake, device replicas) are
// reported as `deferred` in the response rather than silently skipped.

// Execute one plan step as a parameterized DELETE. Table/column are catalog constants (never user
// input) so sql.raw for the identifiers is safe; the subject value is always a bound parameter.
// Never throws — a failing step is captured so the erasure is honestly reported as `partial`.
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

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const subject = body?.subject as string | undefined;
  if (!subject || !subject.trim()) {
    return NextResponse.json({ error: 'subject (email/id) required' }, { status: 400 });
  }

  const plan = planErasure(subject);
  // Execute steps sequentially: dependent rows are ordered before their parents in the catalog.
  const results: StepResult[] = [];
  for (const step of plan.steps) {
    results.push(await executeStep(step));
  }
  const report = summarizeErasure(plan.subject, results, plan.deferred);

  auditFromSession(gate, await currentOrgId(), {
    action: 'data.erasure',
    resource: `subject:${plan.subject}`,
    outcome: report.status === 'completed' ? 'ok' : 'error',
  });

  return NextResponse.json(report);
}
