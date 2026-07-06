import { Waveform } from '@phosphor-icons/react/dist/ssr';
import { StatBand } from '@/components/insights/StatBand';
import { ThresholdManager } from '@/components/observability/ThresholdManager';
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
import { readDriftView, type DriftDisplayStatus } from '@/lib/drift-view';
import { buildDriftStats } from '@/lib/insights-stats';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<DriftDisplayStatus, string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-amber-500/10 text-amber-600',
  drift: 'bg-destructive/10 text-destructive',
};

function fmtScore(score: number | null): string {
  return score === null ? '—' : score.toString();
}

export default async function DriftPage() {
  await requireModuleForUser('drift');
  const { data, error } = await readDriftView();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Waveform className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Model &amp; data drift</h1>
          <p className="text-sm text-muted-foreground">
            Distribution shift + quality degradation over the recent window vs a baseline —
            first-party PSI, or full Evidently test suites when the collector is reachable.
          </p>
        </div>
      </div>

      {error || !data ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Drift unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Could not compute drift right now{error ? `: ${error}` : ''}. The drift engine is
              best-effort — this surface stays reachable and will populate once eval-run history or
              the Evidently collector is available.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Value-forward summary band — verdict, score, drifted-feature count, sample windows. */}
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">Overall verdict</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Engine: {data.engine} · baseline {data.baseline} vs current {data.current} samples
                  {data.lastChecked ? ` · checked ${data.lastChecked.slice(0, 19).replace('T', ' ')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {data.driftScore !== null ? (
                  <span className="text-xs text-muted-foreground">score {data.driftScore}</span>
                ) : null}
                <Badge variant="secondary" className={STATUS_VARIANT[data.status]}>
                  {data.status}
                </Badge>
              </div>
            </CardHeader>
            {data.note ? (
              <CardContent>
                <p className="text-sm text-muted-foreground">{data.note}</p>
              </CardContent>
            ) : null}
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Per-metric / feature drift</CardTitle>
            </CardHeader>
            <CardContent>
              {data.features.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No per-feature drift signals reported yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric / feature</TableHead>
                      <TableHead>Drift score</TableHead>
                      <TableHead>Drifted</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.features.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell className="font-medium text-foreground">{f.name}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtScore(f.score)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {f.drifted ? 'yes' : 'no'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={STATUS_VARIANT[f.status]}>
                            {f.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Management: alert thresholds + baseline reset live here so an operator tunes drift where
          they observe it (the same console-owned settings surfaced on Observability). */}
      <ThresholdManager />
    </div>
  );
}
