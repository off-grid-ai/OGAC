import { ExportersManager } from '@/components/exporters/ExportersManager';
import { listExportTargets } from '@/lib/exporters/store';
import { EXPORTER_CATALOG } from '@/lib/exporters/types';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

// M6 "good citizen" — export the spine (audit / lineage / metrics) to the enterprise's own tooling.
// Full-width CRUD management surface: add/configure exporters, test connections for real, run an
// export now, see the honest last-status. Admin module, org-scoped.

export async function ExportersSurface({
  embedded = false,
}: Readonly<{ embedded?: boolean }> = {}) {
  await requireModuleForUser('exporters');
  const orgId = await currentOrgId();
  const targets = await listExportTargets(orgId).catch(() => []);
  return (
    <PageFrame embedded={embedded}>
      <ExportersManager targets={targets} catalog={[...EXPORTER_CATALOG]} embedded={embedded} />
    </PageFrame>
  );
}
