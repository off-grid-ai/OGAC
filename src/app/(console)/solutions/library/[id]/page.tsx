import { ArrowLeft, ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { BlueprintForm } from '@/components/solutions/BlueprintForm';
import { formatOutcomeCurrency, summarizeOutcome } from '@/lib/outcome-contract';
import { getSolutionBlueprint, listSolutionDeployments } from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function BlueprintDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const orgId = await currentOrgId();
  const { id } = await params;
  const [blueprint, deployments] = await Promise.all([
    getSolutionBlueprint(id, orgId),
    listSolutionDeployments(orgId),
  ]);
  if (!blueprint) notFound();
  const outcome = summarizeOutcome(blueprint.outcome);
  const linked = deployments.filter((deployment) => deployment.blueprintId === id);
  return (
    <PageFrame>
      <div className="space-y-6">
        <header>
          <Link
            href="/solutions/library"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft /> Solution library
          </Link>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-primary">
                {blueprint.industry} · {blueprint.process}
              </p>
              <h1 className="mt-1 text-2xl font-semibold">{blueprint.title}</h1>
              <p className="mt-2 max-w-4xl text-sm text-muted-foreground">{blueprint.summary}</p>
            </div>
            {blueprint.adoptable ? (
              <Link
                href={`/solutions/deployed?blueprint=${encodeURIComponent(blueprint.id)}`}
                className="inline-flex items-center gap-2 text-sm text-primary"
              >
                Deploy through an existing App <ArrowRight />
              </Link>
            ) : (
              <p className="max-w-md text-xs text-muted-foreground">
                Runtime incomplete. Publish the matching App and governed pipeline, and declare
                every required tenant data domain; readiness updates automatically.
              </p>
            )}
          </div>
        </header>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            [
              'Baseline',
              `${blueprint.outcome.baseline.value.toLocaleString()} ${blueprint.outcome.metricUnit}`,
            ],
            [
              'Target',
              `${blueprint.outcome.target.value.toLocaleString()} ${blueprint.outcome.metricUnit}`,
            ],
            ['Definition version', `v${blueprint.currentVersion}`],
            [
              '1Y net value',
              formatOutcomeCurrency(outcome.firstYearNetValue, blueprint.outcome.roi.currency),
            ],
            [
              'Payback',
              outcome.paybackMonths === null ? 'Not justified' : `${outcome.paybackMonths} months`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-card p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-2 text-sm font-medium">{value}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-medium">Requirements</h2>
            <dl className="mt-4 space-y-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Business owner</dt>
                <dd className="mt-1">{blueprint.businessOwner}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Data domains</dt>
                <dd className="mt-1">{blueprint.requiredDataDomains.join(' · ')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Capabilities</dt>
                <dd className="mt-1">{blueprint.requiredCapabilities.join(' · ')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Governed pipeline</dt>
                <dd className="mt-1">{blueprint.requiredPipelineName}</dd>
              </div>
            </dl>
          </section>
          <section className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-medium">Benchmark & proof</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {blueprint.proof.status === 'verified'
                ? blueprint.proof.summary
                : 'Unverified starter hypothesis — no production proof is claimed.'}
            </p>
            <p className="mt-4 text-xs">
              Definition v{blueprint.currentVersion} · evidence {blueprint.proof.status}
            </p>
            {blueprint.proof.evidenceLinks.map((href) => (
              <Link key={href} href={href} className="mt-3 block text-xs text-primary">
                View evidence →
              </Link>
            ))}
          </section>
          <section className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-medium">Deployments</h2>
            <p className="mt-3 text-3xl font-semibold">{linked.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tenant Apps bound to this reusable proof contract.
            </p>
            <Link href="/solutions/deployed" className="mt-4 block text-xs text-primary">
              Manage deployments →
            </Link>
          </section>
        </div>
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
            Edit blueprint contract
          </summary>
          <div className="border-t p-4">
            <BlueprintForm blueprint={blueprint} />
          </div>
        </details>
      </div>
    </PageFrame>
  );
}
