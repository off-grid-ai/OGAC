import { ReportsManager } from '@/components/reports/ReportsManager';
import { requireModuleForUser } from '@/lib/module-access';
import { listReportTemplates } from '@/lib/reports';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Reports management surface — operators create/edit/delete report templates, run them live, and
// export them as signed Markdown/PDF. Built-in reports are seeded and generation-locked; custom
// templates compose the same live section renderers so they can't drift from the dashboards.
export default async function ReportsPage() {
  return <ReportsSurface />;
}

export async function ReportsSurface({ embedded = false }: Readonly<{ embedded?: boolean }> = {}) {
  await requireModuleForUser('reports');
  // Degrade gracefully: DB down → empty template list rather than the whole-page error boundary.
  const templates = await listReportTemplates().catch(() => []);
  return (
    <PageFrame embedded={embedded}>
      <ReportsManager initial={templates} embedded={embedded} />
    </PageFrame>
  );
}
