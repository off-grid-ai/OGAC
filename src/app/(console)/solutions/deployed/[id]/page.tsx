import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { DeploymentForm } from '@/components/solutions/DeploymentForm';
import { ObservationForm } from '@/components/solutions/ObservationForm';
import { getApp } from '@/lib/apps-store';
import { formatOutcomeCurrency } from '@/lib/outcome-contract';
import {
  getSolutionBlueprint,
  getSolutionDeployment,
  listSolutionDeploymentRuns,
  listSolutionObservations,
} from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function DeploymentDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const orgId = await currentOrgId();
  const { id } = await params;
  const deployment = await getSolutionDeployment(id, orgId);
  if (!deployment) notFound();
  const [blueprint, app, observations, runs] = await Promise.all([
    getSolutionBlueprint(deployment.blueprintId, orgId, deployment.blueprintVersion),
    getApp(deployment.appId, orgId),
    listSolutionObservations(deployment.id, orgId),
    listSolutionDeploymentRuns(deployment.id, orgId),
  ]);
  if (!blueprint || !app) notFound();
  const completedRuns = runs.filter((run) => run.status === 'done').length;
  return (
    <PageFrame>
      <div className="space-y-6">
        <header>
          <Link
            href="/solutions/deployed"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <ArrowLeft /> Deployed solutions
          </Link>
          <p className="mt-4 text-[10px] uppercase tracking-widest text-primary">
            {deployment.status}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{blueprint.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bound to the canonical App{' '}
            <Link className="text-primary" href={`/solutions/apps/${app.id}`}>
              {app.title}
            </Link>
            .
          </p>
        </header>
        <div className="grid gap-4 lg:grid-cols-3">
          <Link
            href={`/solutions/library/${blueprint.id}`}
            className="rounded-lg border bg-card p-5"
          >
            <p className="text-xs text-muted-foreground">Proof contract</p>
            <p className="mt-2 font-medium">Blueprint v{deployment.blueprintVersion}</p>
          </Link>
          <div className="rounded-lg border bg-card p-5">
            <p className="text-xs text-muted-foreground">Execution evidence</p>
            <p className="mt-2 font-medium">{completedRuns} completed post-adoption runs</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Since {deployment.activatedAt.toLocaleDateString()}; pre-binding history excluded.
            </p>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <p className="text-xs text-muted-foreground">KPI claims</p>
            <p className="mt-2 font-medium">{observations.length} evidence-backed windows</p>
          </div>
        </div>
        <ObservationForm deploymentId={deployment.id} />
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Run-derived value and operator KPI claims</h2>
          {observations.length ? (
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {observations.map((observation) => (
                <article key={observation.id} className="rounded-lg border bg-card p-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <span>{observation.claimLabel}</span>
                    <strong>{observation.claimedMetricValue.toLocaleString()}</strong>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {observation.windowStart.toLocaleDateString()} –{' '}
                    {observation.windowEnd.toLocaleDateString()}
                  </p>
                  <p className="mt-3 font-medium">
                    {formatOutcomeCurrency(observation.estimatedRoi.netValue, 'USD')} estimated net
                    value
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {observation.estimatedRoi.runsCompleted} completed canonical runs ·{' '}
                    {observation.estimatedRoi.hoursSaved.toLocaleString()} estimated hours ·{' '}
                    {formatOutcomeCurrency(observation.estimatedRoi.actualAiCost, 'USD')} recorded
                    AI cost
                  </p>
                  {observation.evidenceLinks.map((href) => (
                    <Link key={href} href={href} className="mt-2 block text-xs text-primary">
                      Open supporting evidence →
                    </Link>
                  ))}
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
              No KPI claims yet. Record a bounded window with supporting evidence above.
            </p>
          )}
        </section>
        <DeploymentForm deployment={deployment} />
      </div>
    </PageFrame>
  );
}
