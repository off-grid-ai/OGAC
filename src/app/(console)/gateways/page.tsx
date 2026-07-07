import { GatewaysManager } from '@/components/gateways/GatewaysManager';
import { listGatewaysWithHealth } from '@/lib/gateways';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Gateways registry surface (Gateways × Pipelines, P1). First-class model-serving endpoints a
// pipeline runs on — on-prem cluster, OpenAI, Anthropic, OpenRouter — each with its egress class and
// LIVE health merged from the real probes (aggregator + cloud-providers), so availability is honest.
export default async function GatewaysPage() {
  await requireModuleForUser('gateways');
  const orgId = await currentOrgId();
  const gateways = await listGatewaysWithHealth(orgId).catch(() => []);
  return <GatewaysManager gateways={gateways} />;
}
