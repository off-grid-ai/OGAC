import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteBackup } from '@/lib/backups';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// DELETE → delete a single backup dir by bare name. Admin-only. The name is validated by the
// path-safety guard in deleteBackup (rejects "..", separators, absolute paths, escapes) → 400.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const decoded = decodeURIComponent(name ?? '');
  const result = await deleteBackup(decoded);
  if (!result.ok) {
    const badName = result.error?.includes('path-safety') || result.error?.includes('invalid');
    return NextResponse.json(result, { status: badName ? 400 : 500 });
  }
  auditFromSession(gate, await currentOrgId(), {
    action: 'backup.run',
    resource: `backup:${decoded}`,
    outcome: 'ok',
  });
  return NextResponse.json({ object: 'backup_delete', ...result });
}
