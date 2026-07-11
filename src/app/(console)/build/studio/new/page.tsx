import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Suspense } from 'react';
import { AppBuilder } from '@/components/build/AppBuilder';
import { listManagedAgents } from '@/lib/agents';
import { requireModuleForUser } from '@/lib/module-access';
import { getOrgContext, summarizeOrgContext } from '@/lib/org-context';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Full-screen guided builder (Builder Epic Phase 3A) ───────────────────────────────────────────
// The founder's "creating an agent is a screen of its own" surface. Loads the org context ONCE
// (connectors, data domains, tools, guardrails, policy) so the builder can (a) show the inheritance
// banner, and (b) populate the data-domain + existing-agent dropdowns the step editors use to rebind.
// Everything downstream is client-side (AppBuilder): describe → compile → refine → save → run.
export default async function StudioNewPage() {
  await requireModuleForUser('studio');
  const orgId = await currentOrgId();

  const [ctx, agents, pipelines] = await Promise.all([
    getOrgContext(orgId),
    listManagedAgents(orgId).catch(() => []),
    listPipelines(orgId).catch(() => []),
  ]);

  const summary = summarizeOrgContext(ctx);
  const pipelineOptions = pipelines.map((p) => ({ id: p.id, name: p.name }));
  // Only data domains with a real connector binding are usable to bind a connector-query step.
  const domains = ctx.dataDomains
    .filter((d) => d.connectorId && d.resource)
    .map((d) => ({ id: d.id, label: d.label }));
  const agentOptions = agents.map((a) => ({ id: a.id, name: a.name }));
  // Connectors power the inline "Wire a data source" fix-it (create a data-domain without leaving).
  const connectorOptions = ctx.connectors.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  return (
    <div className="w-full space-y-5">
      <div>
        <Link
          href="/build/studio"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Studio
        </Link>
      </div>
      <Suspense fallback={null}>
        <AppBuilder
          summary={summary}
          domains={domains}
          agents={agentOptions}
          connectors={connectorOptions}
          pipelines={pipelineOptions}
        />
      </Suspense>
    </div>
  );
}
