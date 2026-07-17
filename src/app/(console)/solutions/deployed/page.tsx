import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { PageFrame } from '@/components/PageFrame';
import { DeploymentForm } from '@/components/solutions/DeploymentForm';
import { listApps } from '@/lib/apps-store';
import {
  listSolutionBlueprints,
  listSolutionDeploymentCandidates,
  listSolutionDeployments,
} from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function DeployedSolutionsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ blueprint?: string }> }>) {
  const orgId = await currentOrgId();
  const [blueprints, deployments, apps, candidates] = await Promise.all([
    listSolutionBlueprints(orgId),
    listSolutionDeployments(orgId),
    listApps(orgId),
    listSolutionDeploymentCandidates(orgId),
  ]);
  const selectedBlueprintId = (await searchParams).blueprint;
  const blueprintById = new Map(blueprints.map((blueprint) => [blueprint.id, blueprint]));
  const appById = new Map(apps.map((app) => [app.id, app]));
  return (
    <PageFrame>
      <div className="space-y-6">
        <header>
          <p className="text-[10px] uppercase tracking-widest text-primary">Tenant adoption</p>
          <h1 className="mt-1 text-xl font-semibold">Deployed solutions</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            A deployment binds reusable proof to an existing App. The App remains the only owner of
            build, runtime, runs, review, and reports.
          </p>
        </header>
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
            Bind a blueprint to an existing App
          </summary>
          <div className="border-t p-4">
            {apps.length ? (
              <DeploymentForm
                selectedBlueprintId={
                  blueprints.some((item) => item.id === selectedBlueprintId)
                    ? selectedBlueprintId
                    : undefined
                }
                blueprints={blueprints.map((item) => ({
                  id: item.id,
                  label: `${item.title} · v${item.currentVersion}`,
                  version: item.currentVersion,
                }))}
                apps={candidates.map((item) => ({
                  id: item.appId,
                  label: item.appTitle,
                  compatibleBlueprintIds: item.compatibleBlueprintIds,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Create an App first. A deployment never clones or replaces the App.
              </p>
            )}
          </div>
        </details>
        {deployments.length ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {deployments.map((deployment) => {
              const blueprint = blueprintById.get(deployment.blueprintId);
              const app = appById.get(deployment.appId);
              return (
                <Link
                  key={deployment.id}
                  href={`/solutions/deployed/${deployment.id}`}
                  className="group rounded-lg border bg-card p-5 hover:border-primary/50"
                >
                  <div className="flex justify-between gap-3">
                    <div>
                      <span className="text-[10px] uppercase tracking-widest text-primary">
                        {deployment.status}
                      </span>
                      <h2 className="mt-1 font-medium">
                        {blueprint?.title ?? deployment.blueprintId}
                      </h2>
                      <p className="mt-2 text-xs text-muted-foreground">
                        App: {app?.title ?? deployment.appId}
                      </p>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground group-hover:translate-x-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            No blueprints are deployed yet. Bind one to an existing App above.
          </div>
        )}
      </div>
    </PageFrame>
  );
}
