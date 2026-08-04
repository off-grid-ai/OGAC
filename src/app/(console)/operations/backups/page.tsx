import { Suspense } from 'react';
import { BackupsManager } from '@/components/backups/BackupsManager';
import { RestoreDrillCard } from '@/components/backups/RestoreDrillCard';
import { readBackupsView, readDrillRecord, readScheduleStatus } from '@/lib/backups';
import { drillStatus } from '@/lib/dr-drill';
import { requireModuleForUser } from '@/lib/module-access';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

export default async function BackupsPage() {
  await requireModuleForUser('backups');
  const [{ view, error }, schedule, drill] = await Promise.all([
    readBackupsView(),
    readScheduleStatus(),
    // Best-effort: no record resolves to null, which drillStatus reports as NEVER REHEARSED — never as
    // health. A page that lists backups without saying whether one has been restored is only half an
    // answer during an incident.
    readDrillRecord(),
  ]);
  const drillState = drillStatus(drill, new Date());

  const initial = { error, schedule, running: false, ...view };

  return (
    <PageFrame>
      <div className="w-full space-y-4">
        <Suspense fallback={null}>
          <BackupsManager initial={initial} />
        </Suspense>
        {/* After the artefact list: you look for the backup first, then ask whether it can be restored. */}
        <RestoreDrillCard status={drillState} record={drill} />
      </div>
    </PageFrame>
  );
}
