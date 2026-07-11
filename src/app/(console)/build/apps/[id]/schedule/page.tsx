import { notFound } from 'next/navigation';
import { AppScheduleEditor } from '@/components/build/AppScheduleEditor';
import { buildScheduleView, normalizeScheduleConfig } from '@/lib/app-schedule';
import { scheduleRuntimeConfigured } from '@/lib/app-schedules';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app SCHEDULE tab (Builder Gap #1) ─────────────────────────────────────────────────────────
// The config surface for a schedule-triggered app: set the cron + timezone, arm/pause it, and see the
// next fire times computed by the pure app-schedule authority. Resolves the current schedule config
// from the app's trigger, previews it server-side (so the first paint already shows next runs), and
// hands it to the client editor which PATCHes /api/v1/admin/apps/[id]/schedule.
export default async function AppScheduleTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();

  const cfg = normalizeScheduleConfig(app.trigger.kind === 'schedule' ? app.trigger.config : undefined);
  const view = buildScheduleView(id, cfg, scheduleRuntimeConfigured());

  return <AppScheduleEditor appId={id} initialView={view} />;
}
