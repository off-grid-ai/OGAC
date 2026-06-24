import { NextResponse } from 'next/server';
import { getDrift, getEvals, getFlags } from '@/lib/adapters/registry';
import { listEvalRuns } from '@/lib/evals';
import { scoringConfigured } from '@/lib/qa/scoring';

// Agent-QA summary — one call that answers "are the agents still doing a good job?": the latest
// offline eval score, the drift/degradation verdict, and whether online scoring is live. Drives
// the Agent QA dashboard and is the single endpoint a monitor can poll.
export async function GET() {
  const [runs, drift, onlineEnabled] = await Promise.all([
    listEvalRuns(5),
    getDrift().analyze(),
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
