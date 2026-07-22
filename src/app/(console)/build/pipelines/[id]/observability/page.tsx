import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { getEntityObservability, getEntityTraceDetail } from '@/lib/adapters/langfuse-entity';
import { pipelineTraceMatch } from '@/lib/pipeline-api-key-format';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Per-entity AI observability for THIS pipeline — traces, cost, latency, and quality pulled from
// Langfuse and rolled up by the pure `observability-entity` layer (getEntityObservability). URL-driven:
// `?range=` picks the window, `?trace=` deep-links a trace's detail (verified to belong to this
// pipeline). Honest: when tracing is unconfigured/unreachable or no trace matches, it says so — never
// fabricated numbers.
const RANGES = ['24h', '7d', '30d'] as const;
const n = (v: number | null, unit = '') => (v == null ? '—' : `${v.toLocaleString()}${unit}`);
const money = (v: number | null) => (v == null ? '—' : `$${v.toFixed(4)}`);

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-1.5">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums text-foreground">{value}</CardContent>
    </Card>
  );
}

export default async function PipelineObservabilityPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; trace?: string }>;
}>) {
  const { id } = await params;
  const { range: rawRange, trace } = await searchParams;
  const range = RANGES.includes(rawRange as (typeof RANGES)[number]) ? rawRange! : '7d';
  const orgId = await currentOrgId();
  const pipeline = await getPipeline(id, orgId);
  if (!pipeline) notFound();

  const match = pipelineTraceMatch(id);
  const { configured, view, error } = await getEntityObservability(match, range);
  const detail = trace ? (await getEntityTraceDetail(match, trace, range)).detail : null;

  const base = `/build/pipelines/${id}/observability`;
  const latestQuality = view.quality[0];

  return (
    <div className="w-full space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Observe</p>
          <h1 className="text-lg font-semibold">Traces, cost & quality</h1>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`${base}?range=${r}`}
              className={`rounded-md border px-2.5 py-1 text-xs ${r === range ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {r}
            </Link>
          ))}
        </div>
      </div>

      {!configured ? (
        <Card className="shadow-sm">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Tracing isn&apos;t configured on this deployment yet — no Langfuse endpoint. Governed runs
            will appear here once tracing is wired.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label={`Traces (${range})`} value={n(view.traceCount)} />
            <Stat label="Total cost" value={money(view.totalCost)} />
            <Stat label="Avg cost / run" value={money(view.avgCostPerRun)} />
            <Stat label="p50 latency" value={n(view.latency.p50, 'ms')} />
            <Stat label="p95 latency" value={n(view.latency.p95, 'ms')} />
          </div>

          {latestQuality ? (
            <p className="text-xs text-muted-foreground">
              Quality: {view.quality.length} metric(s) tracked — latest{' '}
              {view.quality
                .map((q) => {
                  const s = q as unknown as { metric?: string; points?: { value?: number }[] };
                  const last = s.points?.[s.points.length - 1]?.value;
                  return `${s.metric ?? 'score'} ${last == null ? '—' : last.toFixed(2)}`;
                })
                .join(' · ')}
            </p>
          ) : null}

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent traces</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trace</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Spans</TableHead>
                      <TableHead className="text-right">Quality</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.traces.map((t) => (
                      <TableRow key={t.id} className={t.id === trace ? 'bg-muted/40' : undefined}>
                        <TableCell className="font-medium">
                          <Link href={`${base}?range=${range}&trace=${encodeURIComponent(t.id)}`} className="hover:text-primary hover:underline">
                            {t.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{t.timestamp?.slice(0, 19).replace('T', ' ') ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{n(t.latency, 'ms')}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(t.cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">{n(t.spans)}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.quality == null ? '—' : t.quality.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                    {view.traces.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          No traces for this pipeline in the {range} window{error ? ` (${error})` : ''}.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {detail ? (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  Trace detail
                  <Badge variant="secondary">{detail.name}</Badge>
                  <Link href={`${base}?range=${range}`} className="ml-auto text-xs text-muted-foreground hover:underline">
                    close
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex flex-wrap gap-4 text-muted-foreground">
                  <span>spans: {detail.spanCount}</span>
                  <span>generations: {detail.generationCount}</span>
                  <span>latency: {n(detail.latency, 'ms')}</span>
                  <span>cost: {money(detail.cost)}</span>
                  <span>models: {detail.models.join(', ') || '—'}</span>
                </div>
                {detail.scores.length ? (
                  <div className="flex flex-wrap gap-2">
                    {detail.scores.map((s) => {
                      const sr = s as unknown as { name?: string; value?: number };
                      return (
                        <Badge key={sr.name} variant="outline">
                          {sr.name}: {sr.value == null ? '—' : Number(sr.value).toFixed(2)}
                        </Badge>
                      );
                    })}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
