import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppLifecycleNav } from '@/components/build/AppLifecycleNav';
import { AppReuseActions } from '@/components/build/AppReuseActions';
import { PageFrame } from '@/components/PageFrame';
import { getApp, getAppReuseMeta } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { resolveConsumerChip } from '@/lib/pipeline-chip';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app lifecycle shell (Builder Epic #116) ──────────────────────────────────────────────────
// The founder's ask: "opening an app gives ITS OWN surface with the 5 screens as tabs, scoped to
// that app." This layout wraps every /apps/<id>/* page with the scoped AppLifecycleNav band (Build ·
// Input · Runs · Review · Reports). It resolves the app once here (title + 404) so the child tab
// pages only fetch what they render. Global collection navigation stays in the sidebar while these
// paths so there's exactly one nav band.
export default async function AppShellLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ id: string }>;
}>) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();
  const [pipeline, reuse] = await Promise.all([
    resolveConsumerChip(app.pipelineId ?? null, orgId).catch(() => null),
    getAppReuseMeta(id, orgId).catch(() => null),
  ]);

  return (
    <PageFrame className="space-y-6">
      <AppLifecycleNav appId={app.id} title={app.title} pipeline={pipeline} />
      <div className="flex justify-end">
        <AppReuseActions
          appId={app.id}
          isTemplate={reuse?.isTemplate ?? false}
          templateVars={reuse?.templateVars ?? { vars: [] }}
          lineage={reuse?.lineage ?? null}
        />
      </div>
      {children}
    </PageFrame>
  );
}
