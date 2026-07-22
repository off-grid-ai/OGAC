import { LangfuseDatasetsManager } from '@/components/observability/LangfuseDatasetsManager';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Langfuse-native datasets — golden-set inputs/expected pairs used for evals + experiments. Full CRUD
// over Langfuse's dataset API. List → create → deep-linkable per-dataset detail (items + runs).
export default async function LangfuseDatasetsPage() {
  await requireModuleForUser('observability');
  return (
    <div className="w-full space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Insights · AI · Langfuse</p>
        <h1 className="text-lg font-semibold">Datasets</h1>
        <p className="text-sm text-muted-foreground">
          Curated input / expected-output pairs for evaluating your prompts and agents. Build a
          golden set here, then run experiments against it to track quality over time.
        </p>
      </div>
      <LangfuseDatasetsManager />
    </div>
  );
}
