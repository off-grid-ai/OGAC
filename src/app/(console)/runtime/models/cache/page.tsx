import { CacheDashboard } from '@/components/gateway/CacheDashboard';
import { ConsoleCacheEvidence } from '@/components/gateway/ConsoleCacheEvidence';
import { cacheCounters } from '@/lib/adapters/cache';
import { getCache } from '@/lib/adapters/registry';
import {
  aggregateTallies,
  cacheEvidence,
  cacheSelection,
  type AggregateTally,
} from '@/lib/cache-evidence';
import { readCacheTallies } from '@/lib/cache-tallies-store';
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
  const selection = cacheSelection(port.meta.id, Boolean(port.meta.embedUrl));

  // Every process publishes its own tallies; the totals are their sum. On a failed read we fall back to
  // THIS process's counters and say so — a failed read must not present as a cache nobody has used.
  let aggregate: AggregateTally | null = null;
  let readError: string | undefined;
  try {
    aggregate = aggregateTallies(await readCacheTallies(), Date.now());
  } catch (e) {
    readError = `The other processes’ tallies could not be read: ${
      (e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.message ?? 'unknown error'
    }.`;
  }

  const counters = aggregate ? aggregate.total : cacheCounters();
  return (
    <div className="space-y-4">
      <CacheDashboard />
      <ConsoleCacheEvidence
        counters={counters}
        evidence={cacheEvidence(counters, selection.configuredShared)}
        selection={selection}
        aggregate={aggregate}
        readError={readError}
      />
    </div>
  );
}
