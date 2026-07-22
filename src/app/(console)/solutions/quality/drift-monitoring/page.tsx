import { DriftMonitoringProjects } from '@/components/quality/DriftMonitoringProjects';
import { listDriftProjectsWithSignal } from '@/lib/evidently-projects-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Drift monitoring — the console-owned system of record over retained drift runs. Projects list;
// each opens a detail with report history + a drift-share trend. Full-width, list→detail.
export default async function DriftMonitoringPage() {
  await requireModuleForUser('drift');
  const projects = await listDriftProjectsWithSignal(await currentOrgId());
  return <DriftMonitoringProjects projects={projects} />;
}
