import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { inspectRestore } from '@/lib/backups';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → NON-destructive restore inspection for one backup. Admin-only. Restoring a dump overwrites a
// LIVE database, so the console never runs it from a button — this returns the dump files in the
// backup and the EXACT copy-pasteable restore command an operator runs on S1 during a maintenance
// window (see buildRestorePlan). The name is validated by the path-safety guard in inspectRestore.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const decoded = decodeURIComponent(name ?? '');
  const result = await inspectRestore(decoded);
  if (!result.ok) {
    const badName = result.error?.includes('path-safety') || result.error?.includes('invalid');
    return NextResponse.json(result, { status: badName ? 400 : 404 });
  }
  // Inspecting a restore is a governance-relevant read (an operator is looking at DR commands).
  auditFromSession(gate, await currentOrgId(), {
    action: 'backup.run',
    resource: `backup:restore-inspect:${decoded}`,
    outcome: 'ok',
  });
  return NextResponse.json({ object: 'backup_restore_plan', ...result });
}
