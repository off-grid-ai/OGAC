import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { pruneBackups } from '@/lib/backups';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST → prune every backup outside the console's retention window (best-effort). Admin-only.
// Selection is pure (selectPrunable); each delete goes through the path-safety choke-point.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const result = await pruneBackups();
  auditFromSession(gate, await currentOrgId(), {
    action: 'backup.run',
    resource: 'backup:prune',
    outcome: result.ok ? 'ok' : 'error',
  });
  return NextResponse.json({ object: 'backup_prune', ...result }, { status: result.ok ? 200 : 207 });
}
