import { TokenBudgets } from '@/components/finops/TokenBudgets';
import { GatewayApiKeys } from '@/components/gateway/GatewayApiKeys';
import { GatewayTokens } from '@/components/gateway/GatewayTokens';

/** Compose one route-owned API & budgets place; spend analytics remain under Insights / Cost. */
export function GatewayApiBudgetDestination({ destination }: Readonly<{ destination: string }>) {
  if (destination === 'keys') return <GatewayApiKeys />;
  if (destination === 'clients') return <GatewayTokens />;
  if (destination === 'budgets') return <TokenBudgets />;
  return null;
}
