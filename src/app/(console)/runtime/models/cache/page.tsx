import { CacheDashboard } from '@/components/gateway/CacheDashboard';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Gateway response-cache place — live cache status, flush levers, and hit-rate/savings observability
// over LiteLLM's response cache. Inherits the Models contextual shell (runtime/models/layout.tsx).
// URL-driven via ?range=. Honest about what the deployed proxy's cache API actually supports.
export default async function ModelCachePage() {
  await requireModuleForUser('gateway');
  return <CacheDashboard />;
}
