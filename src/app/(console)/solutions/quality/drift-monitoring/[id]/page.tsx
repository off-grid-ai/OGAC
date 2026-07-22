import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DriftMonitoringActions } from '@/components/quality/DriftMonitoringActions';
import { DriftTrendChart } from '@/components/quality/DriftTrendChart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DriftDisplayStatus, TrendGranularity } from '@/lib/evidently-monitoring';
import { getDriftProjectDetail } from '@/lib/evidently-projects-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<DriftDisplayStatus, string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-muted text-foreground',
  drift: 'bg-destructive/10 text-destructive',
};

export default async function DriftMonitoringDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ granularity?: string }>;
}>) {
  await requireModuleForUser('drift');
  const { id } = await params;
  const { granularity: g } = await searchParams;
  const granularity: TrendGranularity = g === 'hour' ? 'hour' : 'day';
  const detail = await getDriftProjectDetail(id, await currentOrgId(), granularity);
  if (!detail) notFound();
  const { project, history, trend } = detail;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Link
            href="/solutions/quality/drift-monitoring"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Drift monitoring
          </Link>
          <div>
            <h3 className="text-lg font-medium">{project.name}</h3>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              {project.description || 'No description recorded.'}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Dataset: <span className="font-mono">{project.dataset || '—'}</span> · Breach line:{' '}
              {Math.round(project.driftThreshold * 100)}%
            </p>
          </div>
        </div>
        <DriftMonitoringActions project={project} />
      </div>

      {/* signal band */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Signal label="Reports">
          <span className="text-2xl">{history.length}</span>
        </Signal>
        <Signal label="Breaches">
          <span className={`text-2xl ${trend.breaches > 0 ? 'text-destructive' : ''}`}>
            {trend.breaches}
          </span>
        </Signal>
        <Signal label="Peak drift">
          <span className="text-2xl">{trend.peakPct}%</span>
        </Signal>
        <Signal label="Trend">
          <Badge
            variant="secondary"
            className={
              trend.direction === 'up'
                ? STATUS_CLASS.drift
                : trend.direction === 'down'
                  ? STATUS_CLASS.stable
                  : ''
            }
          >
            {trend.direction === 'up' ? 'rising' : trend.direction === 'down' ? 'easing' : 'flat'}
          </Badge>
        </Signal>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Drift share over time</CardTitle>
          <CardDescription className="text-xs">
            Mean drift share per {granularity === 'hour' ? 'hour' : 'day'} across this org&apos;s
            retained drift runs. The dashed line is the project&apos;s breach threshold; points on or
            above it are highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DriftTrendChart trend={trend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Report history</CardTitle>
          <CardDescription className="text-xs">
            Each retained drift run, newest first, with the engine that produced it — a genuine
            Evidently execution is distinguishable from the PSI fallback.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No drift runs recorded yet — run a drift check on the Drift page to start the history.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Engine</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Drift</TableHead>
                    <TableHead className="text-right">Verdict</TableHead>
                    <TableHead className="text-right">Provenance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.startedAt.slice(0, 19).replace('T', ' ')}
                      </TableCell>
                      <TableCell className="text-xs">{r.engineLabel}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.method}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.driftPct === null ? '—' : `${r.driftPct}%`}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className={STATUS_CLASS[r.status]}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.engineProven ? 'default' : 'outline'}>
                          {r.engineProven ? 'Evidently proven' : 'PSI fallback'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Signal({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
