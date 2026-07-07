import { NextResponse } from 'next/server';
import { getDrift, getEvals, getFlags } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { listEvalRuns } from '@/lib/evals';
import { scoringConfigured } from '@/lib/qa/scoring';
import { currentOrgId } from '@/lib/tenancy';

// Agent-QA summary — one call that answers "are the agents still doing a good job?": the latest
// offline eval score, the drift/degradation verdict, and whether online scoring is live. Drives
// the Agent QA dashboard and is the single endpoint a monitor can poll.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const [runs, drift, onlineEnabled] = await Promise.all([
    listEvalRuns(5, orgId),
    getDrift().analyze({ orgId }),
    getFlags().isEnabled('online-evals', true),
  ]);
  const latest = runs[0];
  return NextResponse.json({
    offline: {
      engine: getEvals().meta.id,
      latestScore: latest?.score ?? null,
      latestRunAt: latest?.startedAt ?? null,
      recent: runs.map((r) => ({ id: r.id, score: r.score, startedAt: r.startedAt })),
    },
    drift,
    online: { configured: scoringConfigured(), enabled: onlineEnabled },
  });
}
