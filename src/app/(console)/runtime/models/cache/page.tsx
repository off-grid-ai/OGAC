import { CacheDashboard } from '@/components/gateway/CacheDashboard';
import { ConsoleCacheEvidence } from '@/components/gateway/ConsoleCacheEvidence';
import { cacheCounters } from '@/lib/adapters/cache';
import { getCache } from '@/lib/adapters/registry';
import { cacheEvidence, cacheSelection } from '@/lib/cache-evidence';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Gateway response-cache place — live cache status, flush levers, and hit-rate/savings observability
// over LiteLLM's response cache. Inherits the Models contextual shell (runtime/models/layout.tsx).
// URL-driven via ?range=. Honest about what the deployed proxy's cache API actually supports.
//
// Below it, the console's OWN answer cache. Deliberately a SECOND panel rather than merged into the first:
// they are two different caches in the answer path, and one blended number would describe neither. Read
// in-process because the tallies ARE per-process — which is the failure this panel exists to expose.
export default async function ModelCachePage() {
  await requireModuleForUser('gateway');
  const port = getCache();
  const counters = cacheCounters();
  const selection = cacheSelection(port.meta.id, Boolean(port.meta.embedUrl));
  return (
    <div className="space-y-4">
      <CacheDashboard />
      <ConsoleCacheEvidence
        counters={counters}
        evidence={cacheEvidence(counters, selection.configuredShared)}
        selection={selection}
      />
    </div>
  );
}
