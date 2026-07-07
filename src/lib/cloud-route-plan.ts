// Thin I/O ORCHESTRATION seam: fetch the routing rules + org egress switch + configured providers,
// then delegate to the PURE decideRouting() and planCloudRoute(). One await-once helper the request
// path calls to learn "does this turn go to cloud, stay local, or block?" — all the actual decisions
// stay in the pure modules (routing-policy.ts, cloud-routing.ts, cloud-providers.ts), which are the
// tested chokepoints. This file only wires them to the DB + env.

import { decideRouting } from './routing-policy';
import { planCloudRoute, type CloudPlan } from './cloud-routing';
import { configuredCloudProviders } from './cloud-client';
import { getOrgPolicy, listRoutingRules } from './store';

/**
 * Resolve the cloud/local/block plan for a request with the given routing attributes. The org egress
 * switch is fetched from the policy row (default OFF) and threaded into BOTH the pure decision (which
 * leashes cloud→block when off) and the governance gate (which re-asserts it). PURE logic is
 * delegated; this only does the reads.
 */
export async function resolveCloudPlan(
  attributes: Record<string, string>,
): Promise<CloudPlan> {
  const [rules, policy] = await Promise.all([listRoutingRules(), getOrgPolicy()]);
  const decision = decideRouting(rules, attributes, policy.egressAllowed);
  const providers = configuredCloudProviders();
  return planCloudRoute(decision, providers, policy.egressAllowed);
}
