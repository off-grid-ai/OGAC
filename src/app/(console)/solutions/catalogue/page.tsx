import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { PageFrame } from '@/components/PageFrame';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireModuleForUser } from '@/lib/module-access';
import { listSolutionBlueprints } from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function SolutionCataloguePage() {
  await requireModuleForUser('studio');
  const blueprints = await listSolutionBlueprints(await currentOrgId());

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <header>
          <p className="text-[10px] uppercase tracking-widest text-primary">Ready-made Apps</p>
          <h1 className="mt-1 text-2xl font-semibold">Solution catalogue</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Start with a working enterprise solution instead of rebuilding the workflow. Open one to
            see the data, actions, approvals, and governed AI pipeline it needs from your
            organization.
          </p>
        </header>

        {blueprints.length === 0 ? (
          <EmptyState
            title="No registered solutions"
            description="No registered solutions are visible to your organization. An administrator can register a proven Blueprint from the solution library."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {blueprints.map((blueprint) => (
              <Card key={blueprint.id} className="flex min-w-0 flex-col shadow-none">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[10px] uppercase tracking-widest text-primary">
                      {blueprint.industry} / {blueprint.process}
                    </p>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      v{blueprint.currentVersion}
                    </span>
                  </div>
                  <CardTitle className="text-base leading-snug">{blueprint.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <p className="line-clamp-3 text-sm text-muted-foreground">{blueprint.summary}</p>
                  <dl className="grid grid-cols-2 gap-3 border-t pt-4 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Data</dt>
                      <dd className="mt-1">
                        {blueprint.requiredDataDomains.length}{' '}
                        {blueprint.requiredDataDomains.length === 1 ? 'domain' : 'domains'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Owner</dt>
                      <dd className="mt-1 line-clamp-2">{blueprint.businessOwner}</dd>
                    </div>
                  </dl>
                </CardContent>
                <CardFooter className="border-t pt-4">
                  <ButtonLink id={blueprint.id} />
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageFrame>
  );
}

function ButtonLink({ id }: Readonly<{ id: string }>) {
  return (
    <Link
      href={`/solutions/catalogue/${encodeURIComponent(id)}`}
      className="inline-flex min-h-11 w-full items-center justify-between text-xs text-primary hover:underline"
    >
      Check requirements <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}
