import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { isBackupRunning, readBackupsView, readScheduleStatus, runBackupNow } from '@/lib/backups';

export const dynamic = 'force-dynamic';

// GET → backup / DR status: latest backup + age, total size, count within retention, off-box
// replication config, per-backup rows, the launchd schedule status, and whether a run is in flight.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const [{ view, error }, schedule] = await Promise.all([readBackupsView(), readScheduleStatus()]);
  return NextResponse.json({
    object: 'backups_view',
    error,
    schedule,
    running: isBackupRunning(),
    ...view,
  });
}

// POST → run a backup now (triggers deploy/onprem/backup.sh). Admin-only, guarded against
// concurrent runs (409). Returns the run status (exit code + tail of output).
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await runBackupNow();
    auditFromSession(gate, await currentOrgId(), {
      action: 'backup.run',
      resource: 'backup:run',
      outcome: result.ok ? 'ok' : 'error',
    });
    return NextResponse.json({ object: 'backup_run', ...result }, { status: result.ok ? 201 : 500 });
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === 'CONCURRENT') {
      return NextResponse.json({ error: 'a backup is already running' }, { status: 409 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
