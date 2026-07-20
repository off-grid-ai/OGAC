import { getDrift, getEvals, getFlags } from '@/lib/adapters/registry';
import { listEvalRuns } from '@/lib/evals';
import { scoringConfigured } from '@/lib/qa/scoring';

export interface QaStatus {
  offline: {
    engine: string;
    latestScore: number | null;
    latestRunAt: string | null;
    recent: { id: string; score: number; startedAt: string }[];
  };
  drift: Awaited<ReturnType<ReturnType<typeof getDrift>['analyze']>>;
  online: { configured: boolean; enabled: boolean };
}

// One tenant-scoped read model for the status API and the operator UI. Keeping this orchestration
// here prevents the route and page from drifting into two different definitions of quality health.
export async function readQaStatus(orgId: string): Promise<QaStatus> {
  const [runs, drift, onlineEnabled] = await Promise.all([
    listEvalRuns(5, orgId),
    getDrift().analyze({ orgId }),
    getFlags().isEnabled('online-evals', true),
  ]);
  const latest = runs[0];
  return {
    offline: {
      engine: getEvals().meta.id,
      latestScore: latest?.score ?? null,
      latestRunAt: latest?.startedAt ?? null,
      recent: runs.map((run) => ({ id: run.id, score: run.score, startedAt: run.startedAt })),
    },
    drift,
    online: { configured: scoringConfigured(), enabled: onlineEnabled },
  };
}

