import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { redactBatch, activePiiPort, type RedactionPolicy } from '@/lib/data-redaction';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Sync-path redaction primitive: given a batch of rows + a column policy, return the redacted rows
// + a report of what was changed. This is what the data-movement path calls BEFORE rows land in
// the warehouse — the same PII engine that governs model access, applied to data in flight.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: { rows?: unknown; policy?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : null;
  const policy = Array.isArray(body.policy) ? (body.policy as RedactionPolicy) : null;
  if (!rows || !policy) {
    return NextResponse.json({ error: 'rows[] and policy[] are required' }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const pii = await activePiiPort();
  const result = await redactBatch(rows, policy, pii, orgId);

  auditFromSession(gate, orgId, {
    action: 'data.redact',
    resource: `rows:${rows.length} redacted:${result.totalRedacted} cols:${result.report.length}`,
    outcome: 'ok',
  });
  return NextResponse.json(result, { status: 200 });
}
