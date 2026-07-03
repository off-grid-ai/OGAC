import Link from 'next/link';
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/ssr';
import { getRecentRunsView } from '@/lib/agent-runs-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

// Read-back view of durable-execution / agent runs. Status filtering is driven by the URL
// (?status=…) — a server round-trip, no client state — so the view is linkable and history-aware.
export default async function AgentRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireModuleForUser('agents');
  const { status } = await searchParams;
  const { summary, runs } = await getRecentRunsView(25, await currentOrgId());
  const active = status && summary.statusCounts[status] ? status : undefined;
  const shown = active ? runs.filter((r) => r.status === active) : runs;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ClockCounterClockwise className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Agent Runs</h1>
          <p className="text-sm text-muted-foreground">
            Durable-execution history — every agent/workflow run, its pipeline timeline, and
            outcome. Recorded on-prem.
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

      {/* Status filter — URL driven */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href="/agent-runs"
          className={`rounded-md border px-2 py-1 ${!active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
        >
          all ({summary.totalRuns})
        </Link>
        {Object.entries(summary.statusCounts).map(([s, n]) => (
          <Link
            key={s}
            href={`/agent-runs?status=${encodeURIComponent(s)}`}
            className={`rounded-md border px-2 py-1 ${active === s ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
          >
            {s} ({n})
          </Link>
        ))}
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

      {/* Runs timeline */}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agent runs recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Run</th>
                <th className="p-2">Agent</th>
                <th className="p-2">Status</th>
                <th className="p-2">Steps</th>
                <th className="p-2">Duration</th>
                <th className="p-2">Started</th>
                <th className="p-2">Query</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="p-2 font-mono text-xs">{r.id}</td>
                  <td className="p-2">{r.agentId}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.stepCount}</td>
                  <td className="p-2">{ms(r.durationMs)}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="max-w-xs truncate p-2 text-muted-foreground">{r.query}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
