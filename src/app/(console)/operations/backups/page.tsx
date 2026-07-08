import { Suspense } from 'react';
import { BackupsManager } from '@/components/backups/BackupsManager';
import { readBackupsView, readScheduleStatus } from '@/lib/backups';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function BackupsPage() {
  await requireModuleForUser('backups');
  const [{ view, error }, schedule] = await Promise.all([readBackupsView(), readScheduleStatus()]);

  const initial = { error, schedule, running: false, ...view };

  return (
    <Suspense fallback={null}>
      <BackupsManager initial={initial} />
    </Suspense>
  );
}
