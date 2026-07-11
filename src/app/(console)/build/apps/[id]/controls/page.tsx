import { notFound } from 'next/navigation';
import { AppControlsEditor } from '@/components/build/AppControlsEditor';
import { getControls, usageFor } from '@/lib/app-run-controls-store';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app SAFETY tab — SHADOW MODE + BLAST-RADIUS controls ──────────────────────────────────────
// The BFSI trust surface: let a cautious operator run an autonomous app SAFELY before it acts for
// real. Sets the shadow-default (dry-run every run), the daily run + spend caps, and the kill-switch.
// The effective controls + live usage (runs-today, spend-today) are resolved server-side and handed
// to the client editor, which PATCHes changes to /api/v1/admin/apps/[id]/controls.
export default async function AppControlsTab({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();

  const [controls, usage] = await Promise.all([getControls(id, orgId), usageFor(id, orgId, 0)]);

  return <AppControlsEditor appId={id} initialControls={controls} usage={usage} />;
}
