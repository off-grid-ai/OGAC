import { MetricChart } from '@/components/platform-health/MetricChart';
import { LogsSearchBox, ServiceSelect } from '@/components/platform-health/PlatformControls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { safeJaegerOverview } from '@/lib/jaeger';
import type { HealthDestinationId } from '@/lib/operations-destinations';
import { safeSearchLogs } from '@/lib/victoria-logs';
import { PLATFORM_CHARTS, safePlatformMetrics } from '@/lib/victoria-metrics';

const SOURCE_LABEL: Record<HealthDestinationId, string> = {
  metrics: 'metrics',
  logs: 'logs',
  traces: 'traces',
};

function NotConfigured({ source }: Readonly<{ source: string }>) {
  return (
    <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
      The {source} backend isn&apos;t connected yet. Connect it in Configuration to read live
      telemetry here.
    </p>
  );
}

export async function PlatformHealthDestination({
  destination,
  logsq,
  svc,
}: Readonly<{
  destination: HealthDestinationId;
  logsq?: string;
  svc?: string;
}>) {
  if (destination === 'metrics') return <MetricsDestination />;
  if (destination === 'logs') return <LogsDestination query={logsq} />;
  return <TracesDestination svc={svc} />;
}

async function MetricsDestination() {
  const { configured, charts, targetsUp, error } = await safePlatformMetrics();
  if (!configured) return <NotConfigured source={SOURCE_LABEL.metrics} />;
  const hintByTitle = new Map(PLATFORM_CHARTS.map((chart) => [chart.title, chart.hint]));

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Could not reach VictoriaMetrics: {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-md border border-border px-3 py-1.5">
          Targets up:{' '}
          <span className="font-semibold tabular-nums text-foreground">
            {targetsUp ?? 'awaiting emission'}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          A chart marked not emitting yet is connected, but has no data in the current window.
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {charts.map((chart) => (
          <MetricChart key={chart.title} chart={chart} hint={hintByTitle.get(chart.title)} />
        ))}
      </div>
    </div>
  );
}

async function LogsDestination({ query }: Readonly<{ query?: string }>) {
  const result = await safeSearchLogs(query ?? '', 200);
  if (!result.configured) return <NotConfigured source={SOURCE_LABEL.logs} />;

  return (
    <div className="space-y-4">
      <LogsSearchBox query={result.query} />
      {result.error ? (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Could not reach VictoriaLogs: {result.error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {result.rows.length} line{result.rows.length === 1 ? '' : 's'} for{' '}
        <code>{result.query}</code>
        {result.rows.length === 0 && !result.error ? '. No matching logs in the stream yet.' : '.'}
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Time</TableHead>
              <TableHead className="w-56">Stream</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row, index) => (
              <TableRow key={`${row.time}-${index}`}>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {row.time || '-'}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.stream || '-'}
                </TableCell>
                <TableCell className="font-mono text-xs text-foreground">
                  {row.message || '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

async function TracesDestination({ svc }: Readonly<{ svc?: string }>) {
  const { configured, services, traces, selectedService, webUrl, error } = await safeJaegerOverview(
    svc,
    20,
  );
  if (!configured) return <NotConfigured source={SOURCE_LABEL.traces} />;

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Could not reach Jaeger: {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {services.length ? (
          <ServiceSelect services={services} selected={selectedService} />
        ) : (
          <span className="text-xs text-muted-foreground">
            No services are reporting traces yet. Waiting for OTLP spans.
          </span>
        )}
        {webUrl ? (
          <a
            href={webUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary underline"
          >
            Open full waterfall in Jaeger UI
          </a>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Root operation</TableHead>
              <TableHead className="w-40">Service</TableHead>
              <TableHead className="w-28 text-right">Spans</TableHead>
              <TableHead className="w-28 text-right">Duration</TableHead>
              <TableHead className="w-48">Trace</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {traces.map((trace) => (
              <TableRow key={trace.traceId}>
                <TableCell className="text-sm text-foreground">{trace.rootOperation}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {trace.service}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">{trace.spanCount}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {trace.durationMs} ms
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {webUrl ? (
                    <a
                      href={`${webUrl.replace(/\/search$/, '')}/trace/${encodeURIComponent(trace.traceId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      {trace.traceId.slice(0, 12)}...
                    </a>
                  ) : (
                    `${trace.traceId.slice(0, 12)}...`
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {traces.length === 0 && selectedService && !error ? (
        <p className="text-xs text-muted-foreground">
          No recent traces for <code>{selectedService}</code> in the last hour.
        </p>
      ) : null}
    </div>
  );
}
