import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { clickhouseWarehouse } from '@/lib/adapters/warehouse';

export const dynamic = 'force-dynamic';

// Run an operator-typed READ-ONLY query against the warehouse. The read-only guard lives in the pure
// warehouse-model; a rejected statement (write/DDL/stacked/commented) returns 400 with the reason.
// Audited like the other admin governance routes — the query text is recorded on the audit trace.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const sql = typeof (body as { sql?: unknown })?.sql === 'string' ? (body as { sql: string }).sql : '';
  if (!sql.trim()) {
    return NextResponse.json({ error: 'missing "sql"' }, { status: 400 });
  }

  const org = await currentOrgId();
  const out = await clickhouseWarehouse.query(sql);

  if (!out.ok) {
    // The query text + rejection reason ride on `resource` (AuditEventInput carries no free-form
    // detail field); truncated so a huge statement can't bloat the trace.
    auditFromSession(gate, org, {
      action: 'warehouse.query',
      resource: `warehouse:query rejected(${out.reason}): ${sql.slice(0, 300)}`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: out.reason }, { status: 400 });
  }

  auditFromSession(gate, org, {
    action: 'warehouse.query',
    resource: `warehouse:query rows=${out.result.count}: ${sql.slice(0, 300)}`,
    outcome: 'ok',
  });

  return NextResponse.json({
    columns: out.result.columns,
    rows: out.result.rows,
    count: out.result.count,
  });
}
