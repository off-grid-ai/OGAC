import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { victoriaLogs } from '@/lib/adapters/victorialogs';

export const dynamic = 'force-dynamic';

// GET (admin) — the deployed VictoriaLogs retention period (parsed from its -retentionPeriod flag if
// surfaced, else an honest deploy-managed default). Retention on single-node VictoriaLogs is a
// deploy flag, not a runtime-CRUD-able setting, so this is read-only by design.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await victoriaLogs.retention());
}
