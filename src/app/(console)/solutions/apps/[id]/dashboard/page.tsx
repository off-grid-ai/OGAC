import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { Card, CardContent } from '@/components/ui/card';
import { buildAppDashboard } from '@/lib/app-dashboard';
import { listAppRuns } from '@/lib/app-run-store';
import { getApp } from '@/lib/apps-store';
import { currentOrgId } from '@/lib/tenancy';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// ─── The app's DASHBOARD ─────────────────────────────────────────────────────────────────────────
//
// "it should have the ability to have a dashboard" (docs/APP_AS_PRODUCT.md §2) — the one item on that
// list with no component behind it. Written for the department: how much got through, what is stuck, how
// long it takes, how often a person has to step in. All wording and counting lives in the pure
// app-dashboard rule, which is asserted to leak no platform vocabulary.

export default async function AppDashboardTab({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();

  const rows = await listAppRuns(id, orgId, 500).catch(() => []);
  const dashboard = buildAppDashboard({
    nowMs: Date.now(),
    runs: rows.map((r) => {
      const steps = (r as { steps?: { kind?: string; status?: string }[] }).steps ?? [];
      return {
        status: String(r.status),
        startedAt:
          r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt ?? ''),
        finishedAt:
          (r as { finishedAt?: Date | string | null }).finishedAt instanceof Date
            ? ((r as { finishedAt: Date }).finishedAt).toISOString()
            : ((r as { finishedAt?: string | null }).finishedAt ?? null),
        // "Needed a person" means a human step was actually reached — not merely declared in the spec.
        neededPerson: steps.some((s) => s.kind === 'human' && s.status !== 'queued'),
      };
    }),
  });

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <header>
          <h2 className="text-xl font-semibold tracking-tight">{dashboard.headline}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How this process has been doing.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {dashboard.metrics.map((metric) => (
            <Card
              key={metric.label}
              className={cn(
                'min-w-0 shadow-none',
                metric.tone === 'attention' ? 'border-primary/40' : 'border-border',
              )}
            >
              <CardContent className="space-y-1.5 p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {metric.label}
                </p>
                <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {metric.value}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">{metric.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}
