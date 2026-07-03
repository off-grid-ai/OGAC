import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readBackupsView } from '@/lib/backups';

export const dynamic = 'force-dynamic';

// GET → read-only backup / DR status: latest backup + age, total size, count within retention,
// off-box replication config, and per-backup rows. Read back from the on-prem backup directory
// written by deploy/onprem/backup.sh.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { view, error } = await readBackupsView();
  return NextResponse.json({ object: 'backups_view', error, ...view });
}
