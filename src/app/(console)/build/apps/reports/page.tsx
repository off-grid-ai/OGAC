import { ChartBar, DownloadSimple } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { StatBand } from '@/components/insights/StatBand';
import { StatusBadge } from '@/components/build/AppRunStatus';
import {
  bucketByDay,
  buildReportStats,
  computeReportMetrics,
  stepKindBreakdown,
} from '@/lib/app-reports';
import { progress } from '@/lib/app-runs-view';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { listApps } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Reports / Analytics (Builder Epic Phase 4B — screen 5) ───────────────────────────────────────
// Outcomes over time across app-runs: totals, completions vs failures, HITL approvals vs rejections,
// exceptions, throughput, and cost/tokens when carried. Reuses the pure rollup (app-reports.ts) over
// the runs read by the 4A reader — the page is a thin I/O shell. Filter is URL-driven (?appId=) so it
// is deep-linkable and Back-coherent. Each run offers a "Download report" hitting the signed report
// route (Phase 4B sink). Value-forward: the stat band + charts lead; the table is the drill-down.
export default async function AppReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ appId?: string }>;
}) {
  await requireModuleForUser('studio');
  const orgId = await currentOrgId();
  const { appId } = await searchParams;

  const [runs, apps] = await Promise.all([listAppRunsView(appId, orgId, 200), listApps(orgId)]);
  const appTitle = (id: string) => apps.find((a) => a.id === id)?.title ?? id;

  const metrics = computeReportMetrics(runs);
  const stats = buildReportStats(metrics);
  const buckets = bucketByDay(runs);
  const kinds = stepKindBreakdown(runs);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.total));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ChartBar className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Reports &amp; analytics</h1>
          <p className="text-sm text-muted-foreground">
            Outcomes across your app runs — completions, failures, human decisions, exceptions,
            throughput and cost. Download a signed report for any run.
          </p>
        </div>
      </div>

      {/* App filter chips (URL-driven). */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/build/apps/reports"
          className={`rounded-md border px-2 py-1 text-xs ${
            appId ? 'border-border text-muted-foreground' : 'border-primary/40 bg-primary/10 text-primary'
          }`}
        >
          All apps
        </Link>
        {apps.map((a) => (
          <Link
            key={a.id}
            href={`/build/apps/reports?appId=${encodeURIComponent(a.id)}`}
            className={`rounded-md border px-2 py-1 text-xs ${
              appId === a.id
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {a.title}
          </Link>
        ))}
      </div>

      <StatBand stats={stats} />

      {/* HITL + outcome detail band. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Human decisions (HITL)
          </h2>
          <div className="flex items-baseline gap-4">
            <div>
              <div className="text-2xl font-semibold tabular-nums text-primary">
                {metrics.approvals}
              </div>
              <div className="text-xs text-muted-foreground">approved</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums text-destructive">
                {metrics.rejections}
              </div>
              <div className="text-xs text-muted-foreground">rejected</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums text-amber-600">
                {metrics.awaitingReview}
              </div>
              <div className="text-xs text-muted-foreground">awaiting</div>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Run outcomes
          </h2>
          <dl className="space-y-1 text-sm">
            <Row label="Completed" value={metrics.completed} />
            <Row label="Failed" value={metrics.failed} />
            <Row label="Cancelled" value={metrics.cancelled} />
            <Row label="In flight" value={metrics.running} />
            <Row
              label="Exception rate"
              value={`${Math.round(metrics.exceptionRate * 100)}%`}
            />
          </dl>
        </div>

        <div className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step mix
          </h2>
          {Object.keys(kinds).length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
          ) : (
            <dl className="space-y-1 text-sm">
              {Object.entries(kinds)
                .sort((a, b) => b[1] - a[1])
                .map(([kind, count]) => (
                  <Row key={kind} label={kind} value={count} />
                ))}
            </dl>
          )}
        </div>
      </div>

      {/* Throughput over time — a pure-CSS day-bucket bar chart (no external chart lib). */}
      <div className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Runs over time
        </h2>
        {buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dated runs yet.</p>
        ) : (
          <div className="flex items-end gap-1 overflow-x-auto" style={{ height: 140 }}>
            {buckets.map((b) => (
              <div key={b.day} className="flex min-w-[10px] flex-1 flex-col items-center justify-end gap-1">
                <div
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${Math.round((b.total / maxBucket) * 110)}px` }}
                  title={`${b.day}: ${b.total} runs (${b.completed} done, ${b.failed} failed)`}
                />
                <span className="rotate-0 whitespace-nowrap text-[9px] text-muted-foreground">
                  {b.day.slice(5)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-run table with a signed-report download. */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">App</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Steps</th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2 font-medium">Report</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const p = progress(r.steps);
              return (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{r.id}</td>
                  <td className="px-3 py-2 text-foreground">{appTitle(r.appId)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} small />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {p.done}/{p.total}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={`/api/v1/admin/app-runs/${encodeURIComponent(r.id)}/report?format=pdf`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <DownloadSimple className="size-3" /> PDF
                    </a>
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No runs yet. Run an app to build up analytics here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="capitalize text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
