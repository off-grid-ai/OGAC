import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { geDataQuality } from '@/lib/adapters/data-quality';
import { summarize } from '@/lib/data-quality-model';

export const dynamic = 'force-dynamic';

// Run a data-quality checkpoint against the Great Expectations sidecar. Body:
//   { suite, rows: [ {col: value, ...} ], expectations: [ { type, column?, min?, max?, value_set? } ] }
// Returns the normalized verdict (success + per-expectation pass/fail counts + a one-line summary).
// The adapter fails closed (a well-formed FAILURE verdict, never a throw) when the sidecar is down,
// so this route always returns a legible result. Admin-gated + audited (mirrors the connector-sync
// reference route).
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => ({}))) as {
    suite?: unknown;
    rows?: unknown;
    expectations?: unknown;
  };
  const suite = typeof body.suite === 'string' && body.suite.trim() ? body.suite.trim() : 'default';

  const verdict = await geDataQuality.runCheckpoint(suite, body.rows, body.expectations);

  auditFromSession(gate, await currentOrgId(), {
    action: 'data-quality.checkpoint',
    resource: `suite:${suite}`,
    outcome: verdict.engineReachable ? (verdict.success ? 'ok' : 'fail') : 'error',
  });

  return NextResponse.json({ ...verdict, summary: summarize(verdict) });
}
