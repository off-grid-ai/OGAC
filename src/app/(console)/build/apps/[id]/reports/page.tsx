import { ChartBar, DownloadSimple } from '@phosphor-icons/react/dist/ssr';
import { notFound } from 'next/navigation';
import { StatBand } from '@/components/insights/StatBand';
import { AppRoiCard } from '@/components/build/AppRoiCard';
import { StatusBadge } from '@/components/build/AppRunStatus';
import { resolveRoiSettings } from '@/lib/roi';
import { computeAppRoiRow } from '@/lib/roi-reader';
import { getAppRoiOverride, getOrgRoiDefault } from '@/lib/roi-settings-store';
import {
  bucketByDay,
  buildReportStats,
  computeReportMetrics,
  stepKindBreakdown,
} from '@/lib/app-reports';
import { progress } from '@/lib/app-runs-view';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app REPORTS tab (Builder Epic #116, screen 5) ────────────────────────────────────────────
// Outcomes over time for THIS app: totals, completions vs failures, HITL approvals/rejections,
// exceptions, throughput, cost/tokens. Reuses the pure rollup (app-reports.ts) over the app's runs.
// Each run offers a signed PDF report download (Phase 4B sink).
export default async function AppReportsTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const [app, runs, roi, roiOverride, orgDefault] = await Promise.all([
    getApp(id, orgId),
    listAppRunsView(id, orgId, 200),
    computeAppRoiRow(id, orgId),
    getAppRoiOverride(id, orgId),
    getOrgRoiDefault(orgId),
  ]);
  if (!app) notFound();

  const metrics = computeReportMetrics(runs);
  const stats = buildReportStats(metrics);
  const buckets = bucketByDay(runs);
  const kinds = stepKindBreakdown(runs);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.total));

  return (
    <div className="w-full space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ChartBar className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Outcomes across every run of {app.title} — completions, failures, human decisions,
            exceptions, throughput and cost.
          </p>
        </div>
      </div>

      <StatBand stats={stats} />

      {roi ? (
        <AppRoiCard
          appId={id}
          initial={roi}
          hasOverride={roiOverride !== null}
          orgDefault={resolveRoiSettings(null, orgDefault)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Human decisions (HITL)
          </h2>
          <div className="flex items-baseline gap-4">
            <Metric value={metrics.approvals} label="approved" tone="text-primary" />
            <Metric value={metrics.rejections} label="rejected" tone="text-destructive" />
            <Metric value={metrics.awaitingReview} label="awaiting" tone="text-amber-600" />
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
            <Row label="Exception rate" value={`${Math.round(metrics.exceptionRate * 100)}%`} />
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
                <span className="whitespace-nowrap text-[9px] text-muted-foreground">
                  {b.day.slice(5)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Run</th>
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
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No runs yet. Run this app to build up analytics here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div>
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
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
