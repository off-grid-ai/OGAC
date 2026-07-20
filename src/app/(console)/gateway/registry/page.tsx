import { GatewaysManager } from '@/components/gateways/GatewaysManager';
import { listGatewaysWithHealth } from '@/lib/gateways';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { withTimeout } from '@/lib/with-timeout';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// The Gateways registry surface (Gateways × Pipelines, P1). First-class model-serving endpoints a
// pipeline runs on — on-prem cluster, OpenAI, Anthropic, OpenRouter — each with its egress class and
// LIVE health merged from the real probes (aggregator + cloud-providers), so availability is honest.
//
// The health merge fans out real fetches (aggregator + each cloud provider, ~4s each). Those are
// parallelized inside the lib, but a wedged endpoint could still drag the render past the "instant"
// bar, so we cap the whole merge with a wall-clock ceiling above the probe budget: on a true hang it
// degrades to the empty state (recoverable on refresh) rather than stalling. The `loading.tsx`
// skeleton makes first paint instant regardless of how long the probes take.
export default async function GatewaysPage() {
  await requireModuleForUser('gateways');
  const orgId = await currentOrgId();
  const gateways = await withTimeout(listGatewaysWithHealth(orgId), 5000, []);
  return <PageFrame>{<GatewaysManager gateways={gateways} />}</PageFrame>;
}
