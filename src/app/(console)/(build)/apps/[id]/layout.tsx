import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AppLifecycleNav } from '@/components/build/AppLifecycleNav';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app lifecycle shell (Builder Epic #116) ──────────────────────────────────────────────────
// The founder's ask: "opening an app gives ITS OWN surface with the 5 screens as tabs, scoped to
// that app." This layout wraps every /apps/<id>/* page with the scoped AppLifecycleNav band (Build ·
// Input · Runs · Review · Reports). It resolves the app once here (title + 404) so the child tab
// pages only fetch what they render. The global Build band (BuildNav) suppresses itself on these
// paths so there's exactly one nav band.
export default async function AppShellLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const app = await getApp(id, await currentOrgId());
  if (!app) notFound();

  return (
    <div className="w-full space-y-6">
      <AppLifecycleNav appId={app.id} title={app.title} />
      {children}
    </div>
  );
}
