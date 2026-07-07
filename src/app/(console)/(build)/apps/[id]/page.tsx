import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { AppBuilder } from '@/components/build/AppBuilder';
import { listManagedAgents } from '@/lib/agents';
import { getApp } from '@/lib/apps-store';
import { getOrgContext, summarizeOrgContext } from '@/lib/org-context';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app BUILD tab (Builder Epic #116, screen 1) ──────────────────────────────────────────────
// Mounts the SAME guided builder used to create the app, seeded with the saved app (initialApp) so
// Save PATCHes it in place. Guided + Advanced-visual are both available here; both edit the one spec.
export default async function AppBuildTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const [app, ctx, agents, pipelines] = await Promise.all([
    getApp(id, orgId),
    getOrgContext(orgId),
    listManagedAgents(orgId).catch(() => []),
    listPipelines(orgId).catch(() => []),
  ]);
  if (!app) notFound();

  const summary = summarizeOrgContext(ctx);
  const domains = ctx.dataDomains
    .filter((d) => d.connectorId && d.resource)
    .map((d) => ({ id: d.id, label: d.label }));
  const agentOptions = agents.map((a) => ({ id: a.id, name: a.name }));
  const connectorOptions = ctx.connectors.map((c) => ({ id: c.id, name: c.name, type: c.type }));
  const pipelineOptions = pipelines.map((p) => ({ id: p.id, name: p.name }));

  return (
    <Suspense fallback={null}>
      <AppBuilder
        summary={summary}
        domains={domains}
        agents={agentOptions}
        connectors={connectorOptions}
        pipelines={pipelineOptions}
        initialApp={app}
      />
    </Suspense>
  );
}
