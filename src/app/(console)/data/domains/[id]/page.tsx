import { ArrowLeft, Signpost } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainDetailPanel } from '@/components/data-domains/DomainDetailPanel';
import { listApps } from '@/lib/apps-store';
import { appsUsingDomain } from '@/lib/data-domain-usage';
import { getDomain, listDomains } from '@/lib/data-domains-store';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelinesByDomain } from '@/lib/pipelines';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Data-domain DETAIL — the deep view behind one routing rule: its full binding (label + aliases →
// connector · resource), a cross-link into the bound connector, edit/delete, and a scoped
// test-resolve that runs the pure resolver across all domains so the operator can confirm this rule
// wins the phrases they expect. Reached by clicking a domain card on the Data domains page.
export default async function DataDomainDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('data-domains');
  const { id } = await params;
  const org = await currentOrgId();
  const [domain, allDomains, connectors, apps] = await Promise.all([
    getDomain(id, org),
    listDomains(org),
    listConnectors(org),
    listApps(org).catch(() => []),
  ]);
  if (!domain) notFound();

  const connectorName =
    connectors.find((c) => c.id === domain.connectorId)?.name ?? domain.connectorId;
  const connectorOptions = connectors.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  // Reverse edge: pipelines whose data ceiling allowlists this domain (matched by id/label/aliases).
  const referencedByPipelines = (
    await listPipelinesByDomain(
      { id: domain.id, label: domain.label, aliases: domain.aliases },
      org,
    ).catch(() => [])
  ).map((p) => ({ id: p.id, name: p.name, status: p.status }));

  // …and the apps whose steps read through it. Same pure matcher the list page uses.
  const referencedByApps = appsUsingDomain(
    apps.map((a) => ({ id: a.id, title: a.title, steps: a.steps })),
    { id: domain.id, label: domain.label, aliases: domain.aliases },
  ).map((a) => ({ id: a.id, title: a.title }));

  return (
    <PageFrame>
      {
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Signpost className="size-5" />
            </div>
            <div>
              <Link
                href="/data/domains"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3" /> Data domains
              </Link>
              <h1 className="mt-1 text-lg font-semibold text-foreground">{domain.label}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                A deterministic rule: a phrase resolves to this connector + resource, by rule, never
                a guess.
              </p>
            </div>
          </div>

          <DomainDetailPanel
            domain={{ ...domain, connectorName }}
            connectorName={connectorName}
            connectors={connectorOptions}
            allDomains={allDomains}
            referencedByPipelines={referencedByPipelines}
            referencedByApps={referencedByApps}
          />
        </div>
      }
    </PageFrame>
  );
}
