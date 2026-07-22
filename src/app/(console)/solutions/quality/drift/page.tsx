import { DriftCatalog } from '@/components/drift/DriftCatalog';
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
import { getDrift } from '@/lib/adapters/registry';
import { describeDriftAttribution } from '@/lib/drift-run';
import { listDriftRuns } from '@/lib/drift-runs';
import { readDriftView, type DriftDisplayStatus } from '@/lib/drift-view';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<DriftDisplayStatus, string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-muted text-foreground',
  drift: 'bg-destructive/10 text-destructive',
};

export default async function QualityDriftPage() {
  await requireModuleForUser('drift');
  const orgId = await currentOrgId();
  const { data, error } = await readDriftView({ orgId });
  const retained = await listDriftRuns(10, orgId);
  const adapter = getDrift().meta;
  const engineStatus = {
    evidentlySelected: adapter.id === 'evidently',
    evidentlyConfigured: Boolean(adapter.embedUrl),
  };

  return (
    <div className="grid w-full gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Signal label="Verdict">
            <Badge variant="secondary" className={data ? STATUS_CLASS[data.status] : ''}>
              {data?.status ?? 'unavailable'}
            </Badge>
          </Signal>
          <Signal label="Engine">
            <span className="text-sm">{data?.engine ?? adapter.id}</span>
          </Signal>
          <Signal label="Baseline window">
            <span className="text-2xl">{data?.baseline ?? 0}</span>
          </Signal>
          <Signal label="Current window">
            <span className="text-2xl">{data?.current ?? 0}</span>
          </Signal>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Current drift evidence</CardTitle>
            <CardDescription className="text-xs">
              {data?.note ?? error ?? 'No drift evidence was returned.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!data || data.features.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                At least four recorded evaluation runs are required before the built-in comparison
                can form baseline and current windows.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric or feature</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.features.map((feature) => (
                      <TableRow key={feature.name}>
                        <TableCell className="font-medium">{feature.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {feature.score ?? 'not reported'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={STATUS_CLASS[feature.status]}>
                            {feature.status}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Engine availability</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {engineStatus.evidentlySelected && engineStatus.evidentlyConfigured
              ? 'Evidently is selected and configured. Catalog selections run through the collector.'
              : 'Evidently is not the verified active path. Checks run with the built-in eval-score PSI and mean-degradation fallback, and results remain attributed to that engine.'}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Retained drift runs</CardTitle>
            <CardDescription className="text-xs">
              Each run is persisted with its engine attribution, so a genuine Evidently execution is
              distinguishable from the PSI fallback after the fact.{' '}
              <a href="/solutions/quality/drift-monitoring" className="text-primary hover:underline">
                Track drift over time in monitoring projects →
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {retained.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No drift runs recorded yet — run a drift check to start the history.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Engine</TableHead>
                      <TableHead className="text-right">Drift</TableHead>
                      <TableHead className="text-right">Verdict</TableHead>
                      <TableHead className="text-right">Provenance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {retained.map((run) => {
                      const a = describeDriftAttribution(
                        run.attribution as Record<string, unknown> | null,
                      );
                      return (
                        <TableRow key={run.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {run.startedAt.slice(0, 19).replace('T', ' ')}
                          </TableCell>
                          <TableCell className="text-xs">
                            {a?.engineLabel ?? run.engine}
                            {a?.evidentlyVersion ? (
                              <span className="text-muted-foreground"> {a.evidentlyVersion}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {run.driftShare === null ? '—' : `${Math.round(run.driftShare * 100)}%`}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="secondary"
                              className={STATUS_CLASS[run.status as DriftDisplayStatus] ?? ''}
                            >
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={a?.engineProven ? 'default' : 'outline'}>
                              {a?.engineProven ? 'Evidently proven' : 'PSI fallback'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Run a drift check</CardTitle>
          <CardDescription className="text-xs">
            Choose a supported preset or method. The result states which engine actually ran.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DriftCatalog engineStatus={engineStatus} />
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
