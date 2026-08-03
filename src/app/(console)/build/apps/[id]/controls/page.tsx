import { notFound } from 'next/navigation';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
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

  return (
    <div className="space-y-6">
      <AppControlsEditor appId={id} initialControls={controls} usage={usage} />

      {/* DELETING THE APP LIVES HERE, not on the browsing grid.
          It was a trash icon beside "Open" on every card in the apps list — a destructive action at
          equal prominence with the one everybody clicks, where a mis-click destroys a process a
          department depends on. It has to remain reachable (every module is full CRUD), so it moved to
          the app's own Safety tab, next to the kill-switch, behind the existing confirmation. */}
      <div className="rounded-md border border-destructive/40 p-4">
        <h2 className="text-sm font-medium text-foreground">Delete this app</h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Removes {app.title} and stops any work reaching it. Its past runs stay in the record for
          audit. This cannot be undone.
        </p>
        <div className="mt-3">
          <DeleteRowButton url={`/api/v1/admin/apps/${id}`} label={app.title} />
        </div>
      </div>
    </div>
  );
}
