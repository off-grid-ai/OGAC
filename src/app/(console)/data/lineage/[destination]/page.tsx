import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LineageDatasetCatalog } from '@/components/lineage/LineageCurate';
import { LineageGovernance } from '@/components/lineage/LineageGovernance';
import { LineageGraph, LineageStoreUnavailable } from '@/components/lineage/LineageGraph';
import { LineageRunHistory } from '@/components/lineage/LineageRunHistory';
import { LineageRuns } from '@/components/lineage/LineageRuns';
import { marquezLineageReader } from '@/lib/adapters/marquez-lineage';
import { listAgentRuns } from '@/lib/agentrun';
import { readLineageView } from '@/lib/marquez';
import type { NamespaceOwnershipView } from '@/lib/marquez-lineage';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { contextualDestination, contextualModule } from '@/modules/contextual-navigation';

export const dynamic = 'force-dynamic';

// The Runs leaf carries three URL-driven sub-views (kept in ?view= so Back is coherent):
//   history    → REAL Marquez run history: state, timing, duration, nominal-time facet (list→detail)
//   governance → namespace ownership + tag registry (full CRUD management)
//   sources    → the source→answer citation trail of grounded agent runs
const RUN_VIEWS = [
  { id: 'history', label: 'Run history' },
  { id: 'governance', label: 'Governance' },
  { id: 'sources', label: 'Source → answer' },
] as const;
type RunView = (typeof RUN_VIEWS)[number]['id'];

function resolveView(raw: string | string[] | undefined): RunView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return RUN_VIEWS.some((r) => r.id === v) ? (v as RunView) : 'history';
}

function first(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.trim() ? v.trim() : null;
}

// Choose the active namespace: the URL's ?namespace=, else the console namespace, else the first
// non-default, else the first available.
function chooseNamespace(list: NamespaceOwnershipView[], requested: string | null): string | null {
  if (requested) return requested;
  if (!list.length) return null;
  const want = process.env.OFFGRID_LINEAGE_NAMESPACE ?? 'offgrid-console';
  return (
    list.find((n) => n.name === want)?.name ??
    list.find((n) => n.name !== 'default')?.name ??
    list[0].name
  );
}

function RunsNav({ view, namespace }: Readonly<{ view: RunView; namespace: string | null }>) {
  const qs = (id: RunView) => {
    const p = new URLSearchParams({ view: id });
    if (namespace) p.set('namespace', namespace);
    return `/data/lineage/runs?${p.toString()}`;
  };
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
      {RUN_VIEWS.map((r) => (
        <Link
          key={r.id}
          href={qs(r.id)}
          scroll={false}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            r.id === view
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          }`}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}

async function RunsSurface({
  searchParams,
}: Readonly<{ searchParams: Record<string, string | string[] | undefined> }>) {
  const view = resolveView(searchParams.view);
  const requestedNs = first(searchParams.namespace);

  const nsEnvelope = await marquezLineageReader.listNamespaces();
  const namespace = chooseNamespace(nsEnvelope.data, requestedNs);

  return (
    <div className="w-full space-y-4">
      <RunsNav view={view} namespace={namespace} />
      {view === 'governance' ? (
        <LineageGovernance
          namespaces={nsEnvelope.data}
          tags={(await marquezLineageReader.listTags()).data}
        />
      ) : view === 'sources' ? (
        <LineageRuns runs={await listAgentRuns(25, await currentOrgId()).catch(() => [])} />
      ) : (
        <HistoryView searchParams={searchParams} namespace={namespace} nsError={nsEnvelope.error} />
      )}
    </div>
  );
}

async function HistoryView({
  searchParams,
  namespace,
  nsError,
}: Readonly<{
  searchParams: Record<string, string | string[] | undefined>;
  namespace: string | null;
  nsError: string | null;
}>) {
  const selectedJob = first(searchParams.job);
  const jobsEnvelope = namespace
    ? await marquezLineageReader.listJobs(namespace)
    : { data: [], error: nsError };
  const history =
    namespace && selectedJob
      ? (await marquezLineageReader.readRunHistory(namespace, selectedJob)).data
      : null;

  const jobHref = (job: string) => {
    const p = new URLSearchParams({ view: 'history', job });
    if (namespace) p.set('namespace', namespace);
    return `/data/lineage/runs?${p.toString()}`;
  };

  return (
    <LineageRunHistory
      namespace={namespace}
      jobs={jobsEnvelope.data}
      selectedJob={selectedJob}
      history={history}
      error={jobsEnvelope.error}
      jobHref={jobHref}
    />
  );
}

export default async function LineageDestinationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ destination: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireModuleForUser('lineage');
  const { destination: rawDestination } = await params;
  const destination = contextualDestination(contextualModule('data-lineage'), rawDestination);
  if (!destination) notFound();

  if (destination.id === 'runs') return <RunsSurface searchParams={await searchParams} />;

  const lineage = await readLineageView();
  if (destination.id === 'graph') return <LineageGraph {...lineage} />;

  if (!lineage.configured || lineage.error) {
    return <LineageStoreUnavailable error={lineage.error} />;
  }

  return (
    <LineageDatasetCatalog
      datasets={lineage.data.datasets.map((dataset) => dataset.name)}
      activeNamespace={lineage.data.namespace}
    />
  );
}
