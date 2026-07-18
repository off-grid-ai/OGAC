import { ThresholdManager } from '@/components/observability/ThresholdManager';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function QualityThresholdsPage() {
  await requireModuleForUser('observability');
  return (
    <div className="w-full">
      <ThresholdManager />
    </div>
  );
}
