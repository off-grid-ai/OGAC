import { notFound } from 'next/navigation';
import { AppVersionHistory } from '@/components/build/AppVersionHistory';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app HISTORY tab — versions, what changed, and the way back ────────────────────────────────
// ROADMAP §10 Flow 7 steps 5 and 7 ("compares with previous versions", "rolls out or rolls back") and
// §11's "human control … reversal". Pipelines had version history and a rollback; apps had neither,
// and an app run is what an operator is usually investigating when something goes wrong.
export default async function AppHistoryTab({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const app = await getApp(id, await currentOrgId());
  if (!app) notFound();
  return <AppVersionHistory appId={id} />;
}
