import { ArrowRight, Plus } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { BlueprintForm } from '@/components/solutions/BlueprintForm';
import { formatOutcomeCurrency, summarizeOutcome } from '@/lib/outcome-contract';
import { listSolutionBlueprints } from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function SolutionLibraryPage() {
  const blueprints = await listSolutionBlueprints(await currentOrgId());
  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-widest text-primary">Use-case contracts</p>
        <h1 className="mt-1 text-xl font-semibold">Solution library</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Reusable BFSI contracts define the owner, requirements, outcome hypothesis, and evidence.
          A Blueprint is deployable only after a real App and governed pipeline implement it.
        </p>
      </header>
      <details className="rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium">
          <Plus /> Create a custom blueprint
        </summary>
        <div className="border-t p-4">
          <BlueprintForm />
        </div>
      </details>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {blueprints.map((blueprint) => {
          const summary = summarizeOutcome(blueprint.outcome);
          return (
            <Link
              key={blueprint.id}
              href={`/solutions/library/${blueprint.id}`}
              className="group rounded-lg border bg-card p-5 transition-colors hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-primary">
                    {blueprint.industry} · {blueprint.process}
                  </span>
                  <h2 className="mt-1 font-medium">{blueprint.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {blueprint.adoptable
                      ? 'Adoptable runtime'
                      : 'Hypothesis only - no runtime asset'}
                  </p>
                </div>
                <ArrowRight className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{blueprint.summary}</p>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t pt-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Target</p>
                  <p className="mt-1 font-medium">
                    {summary.targetChangePct === null
                      ? 'New capability'
                      : `${summary.targetChangePct}%`}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">1Y value</p>
                  <p className="mt-1 font-medium">
                    {formatOutcomeCurrency(
                      summary.firstYearNetValue,
                      blueprint.outcome.roi.currency,
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Proof</p>
                  <p className="mt-1 font-medium">
                    v{blueprint.currentVersion} · {blueprint.proof.status}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
