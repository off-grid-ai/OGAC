import { LangfusePromptsManager } from '@/components/observability/LangfusePromptsManager';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Langfuse-native prompt registry — full CRUD over Langfuse's prompt management API (distinct from the
// console's OWN prompt store under /work/prompts). List → create → deep-linkable per-prompt detail.
export default async function LangfusePromptsPage() {
  await requireModuleForUser('observability');
  return (
    <div className="w-full space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Insights · AI · Langfuse</p>
        <h1 className="text-lg font-semibold">Prompt registry</h1>
        <p className="text-sm text-muted-foreground">
          Version-controlled prompts stored in Langfuse — create text or chat prompts, cut new
          versions, and move the <span className="font-mono text-emerald-600">production</span> label
          to control which version your apps fetch at runtime.
        </p>
      </div>
      <LangfusePromptsManager />
    </div>
  );
}
