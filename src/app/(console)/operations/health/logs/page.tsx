import { Suspense } from 'react';
import { PageFrame } from '@/components/PageFrame';
import { LogsExplorer } from '@/components/operations/LogsExplorer';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Centralized fleet log search — the surface an operator reaches for during an incident. LogsQL
// query + time range + service/level filters, a volume histogram, expandable results, and the
// deployed retention. URL-driven (?q= / ?range= / ?service= / ?level=), so a search is
// deep-linkable and Back-coherent. Gated behind the same platform-health module as the rest of the
// health surfaces.
export default async function LogsPage() {
  await requireModuleForUser('platform-health');
  return (
    <PageFrame>
      <div className="mb-4">
        <h1 className="text-lg font-semibold">Log search</h1>
        <p className="text-sm text-muted-foreground">
          Search the centralized fleet logs with LogsQL. Filter by service and level, scope the time
          range, and expand any entry for its full field set.
        </p>
      </div>
      <Suspense fallback={null}>
        <LogsExplorer />
      </Suspense>
    </PageFrame>
  );
}
