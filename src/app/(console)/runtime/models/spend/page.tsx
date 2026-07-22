import { SpendDashboard } from '@/components/gateway/SpendDashboard';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Gateway spend / FinOps place — cost, token, and request attribution over LiteLLM's DB-backed spend
// ledger, by model / virtual-key / time window with a per-request drill-down. Inherits the Models
// contextual shell (runtime/models/layout.tsx). URL-driven via ?range= and ?groupBy=.
export default async function ModelSpendPage() {
  await requireModuleForUser('gateway');
  return <SpendDashboard />;
}
