import { listAgentRuns } from '@/lib/agentrun';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { type RunsView, summarizeRuns } from '@/lib/agent-runs';

// Thin adapter over the existing agentrun store: pull recent runs and normalize them through the
// pure `summarizeRuns` rule. This is the only I/O seam for the read-back surface.
export async function getRecentRunsView(
  limit = 25,
  orgId: string = DEFAULT_ORG,
): Promise<RunsView> {
  const records = await listAgentRuns(limit, orgId);
  return summarizeRuns(records);
}
