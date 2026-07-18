import { DriftCatalog } from '@/components/drift/DriftCatalog';
import { StatBand } from '@/components/insights/StatBand';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getDrift } from '@/lib/adapters/registry';
import { readDriftView, type DriftDisplayStatus } from '@/lib/drift-view';
import { buildDriftStats } from '@/lib/insights-stats';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<DriftDisplayStatus, string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-muted text-foreground',
  drift: 'bg-destructive/10 text-destructive',
};

export default async function QualityDriftPage() {
  await requireModuleForUser('drift');
  const [{ data, error }, driftMeta] = await Promise.all([
    readDriftView(),
    Promise.resolve(getDrift().meta),
  ]);
  const engineStatus = {
    evidentlySelected: driftMeta.id === 'evidently',
    evidentlyConfigured: Boolean(driftMeta.embedUrl),
  };

  return (
    <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        {error || !data ? (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Drift unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                The drift result could not be computed{error ? `: ${error}` : ''}. This page remains
                available and populates once evaluation history or the drift collector responds.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <StatBand
              stats={buildDriftStats({
                status: data.status,
                driftScore: data.driftScore,
                features: data.features,
                baseline: data.baseline,
                current: data.current,
              })}
            />
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-sm">Overall verdict</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {engineLabel(data.engine)} · baseline {data.baseline} · current {data.current}
                    {data.lastChecked ? ` · ${formatTimestamp(data.lastChecked)}` : ''}
                  </p>
                </div>
                <Badge variant="secondary" className={STATUS_CLASS[data.status]}>
                  {data.status}
                </Badge>
              </CardHeader>
              {data.note ? (
                <CardContent>
                  <p className="text-xs text-muted-foreground">{data.note}</p>
                </CardContent>
              ) : null}
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm">Metric and feature drift</CardTitle>
              </CardHeader>
              <CardContent>
                {data.features.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No per-feature drift signals yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Metric or feature</TableHead>
                          <TableHead className="text-right">Score</TableHead>
                          <TableHead className="text-right">Drifted</TableHead>
                          <TableHead className="text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.features.map((feature) => (
                          <TableRow key={feature.name}>
                            <TableCell className="font-medium text-foreground">
                              {feature.name}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {feature.score ?? '—'}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {feature.drifted ? 'yes' : 'no'}
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
          </>
        )}
      </div>

      <Card className="h-fit shadow-sm xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Run a drift check</CardTitle>
          <p className="text-xs text-muted-foreground">
            Select a preset or per-column test. The active collector runs it when available; the
            built-in PSI path remains the fallback.
          </p>
        </CardHeader>
        <CardContent>
          <DriftCatalog engineStatus={engineStatus} />
        </CardContent>
      </Card>
    </div>
  );
}

function engineLabel(engine: string): string {
  if (engine === 'evidently') return 'Statistical drift tests';
  if (engine === 'psi' || engine === 'heuristic') return 'Built-in PSI';
  return engine === 'unknown' ? 'Drift checks' : engine;
}

function formatTimestamp(value: string): string {
  return value.slice(0, 19).replace('T', ' ');
}
