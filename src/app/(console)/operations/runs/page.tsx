import { Suspense } from 'react';
import { RunsMonitor } from '@/components/operations/RunsMonitor';
import { WorkerReadinessPanel } from '@/components/services/WorkerReadinessPanel';
import { requireModuleForUser } from '@/lib/module-access';
import { filterRuns, paginate, parseKind, parseStatus, summarizeRuns } from '@/lib/runs-monitor';
import { listAllRuns } from '@/lib/runs-monitor-reader';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// ─── Operations → Runs — the unified run/job operations surface ───────────────────────────────────
// A single place to SEE every job across the platform (apps, agents, chat) and its live status.
// Server-renders the first (URL-filtered) page from the authoritative run tables; the client
// RunsMonitor takes over for interactive filtering + live refresh. URL-driven (?kind=&status=&q=).
export default async function RunsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ kind?: string; status?: string; q?: string }>;
}>) {
  await requireModuleForUser('runs');
  const { kind: kindRaw, status: statusRaw, q: qRaw } = await searchParams;
  const orgId = await currentOrgId();

  const all = await listAllRuns(orgId);
  const summary = summarizeRuns(all);
  const kind = parseKind(kindRaw);
  const status = parseStatus(statusRaw);
  const q = qRaw ?? '';
  const page = paginate(filterRuns(all, { kind, status, q }), 0, 200);

  const initial = {
    data: page.rows,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
    summary,
  };

  return (
    <PageFrame>
      <div className="space-y-4">
        {/* Durable-worker health up top: when runs pile up in `running`, this immediately shows
            WHETHER a worker is actually draining each queue (e.g. agent-worker: no poller) — the
            signal that was previously buried in the per-service detail page. */}
        <WorkerReadinessPanel />
        <Suspense fallback={null}>
          <RunsMonitor initial={initial} />
        </Suspense>
      </div>
    </PageFrame>
  );
}
