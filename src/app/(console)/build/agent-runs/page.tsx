import { ClockCounterClockwise } from '@phosphor-icons/react/dist/ssr';
import { Suspense } from 'react';
import { AgentRunsTabs } from '@/components/agent-runs/AgentRunsTabs';
import { getRecentRunsView } from '@/lib/agent-runs-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

// Agent-runs management surface. The server renders the aggregate rollup + summary tiles; the
// interactive runs table (re-run / cancel / delete / review actions + URL-driven detail drill-in)
// is the client AgentRunsManager. Navigation (status filter, ?run=<id> detail) lives in the URL.
export default async function AgentRunsPage() {
  await requireModuleForUser('agent-runs');
  const { summary, runs } = await getRecentRunsView(25, await currentOrgId());

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ClockCounterClockwise className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Agent Runs</h1>
          <p className="text-sm text-muted-foreground">
            Durable jobs — which agent workflows are running now, at what state, and their outcome.
            Re-run a finished job, cancel a running one, review the recorded timeline, or schedule
            recurring runs. Recorded on-prem.
          </p>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Runs</div>
          <div className="text-lg font-semibold text-foreground">{summary.totalRuns}</div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Total time</div>
          <div className="text-lg font-semibold text-foreground">{ms(summary.totalDurationMs)}</div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Avg / run</div>
          <div className="text-lg font-semibold text-foreground">{ms(summary.avgDurationMs)}</div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Step kinds</div>
          <div className="text-lg font-semibold text-foreground">{summary.stepRollup.length}</div>
        </div>
      </div>

      {/* Per-kind step rollup */}
      {summary.stepRollup.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.stepRollup.map((r) => (
            <span
              key={r.kind}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
            >
              {r.kind}: {r.count}× · {ms(r.totalMs)}
            </span>
          ))}
        </div>
      )}

      <Suspense fallback={null}>
        <AgentRunsTabs
          runs={runs}
          statusCounts={summary.statusCounts}
          totalRuns={summary.totalRuns}
        />
      </Suspense>
    </div>
  );
}
