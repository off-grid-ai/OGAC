import { Pulse } from '@phosphor-icons/react/dist/ssr';
import { MetricChart } from '@/components/platform-health/MetricChart';
import {
  LogsSearchBox,
  ServiceSelect,
  TabSwitcher,
} from '@/components/platform-health/PlatformControls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { safeJaegerOverview } from '@/lib/jaeger';
import { requireModuleForUser } from '@/lib/module-access';
import { safeSearchLogs } from '@/lib/victoria-logs';
import { PLATFORM_CHARTS, safePlatformMetrics } from '@/lib/victoria-metrics';

export const dynamic = 'force-dynamic';

// Platform-health read-back surface: metrics (VictoriaMetrics), logs (VictoriaLogs), traces (Jaeger)
// — the observability stack fed by the OTel collector. Every navigational value (the active tab, the
// LogsQL query, the trace service) is URL-driven via searchParams per the navigation mandate, so the
// view is deep-linkable and Back-coherent. Each backend is read via its `safe*` adapter: unset →
// honest "not configured" note; unreachable → an error note; a metric with no data → an explicit
// "not emitting yet" empty state. NEVER fabricated numbers.
type TabId = 'metrics' | 'logs' | 'traces';

function pickTab(v: string | undefined): TabId {
  return v === 'logs' || v === 'traces' ? v : 'metrics';
}

const SOURCE_LABEL: Record<string, string> = {
  metrics: 'metrics',
  logs: 'logs',
  traces: 'traces',
};

function NotConfigured({ source }: Readonly<{ source: string }>) {
  return (
    <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
      The {source} backend isn&apos;t connected yet. Connect it in Settings to read live telemetry
      here.
    </p>
  );
}

export default async function PlatformHealthPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ tab?: string; logsq?: string; svc?: string }>;
}>) {
  await requireModuleForUser('platform-health');
  const { tab: rawTab, logsq, svc } = await searchParams;
  const tab = pickTab(rawTab);

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Pulse className="size-4" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-foreground">Platform Health</h1>
          <p className="text-sm text-muted-foreground">
            Live metrics, logs, and traces from the observability stack — read back on-prem from
            VictoriaMetrics, VictoriaLogs, and Jaeger.
          </p>
        </div>
      </div>

      <TabSwitcher active={tab} />

      {tab === 'metrics' && <MetricsTab />}
      {tab === 'logs' && <LogsTab query={logsq} />}
      {tab === 'traces' && <TracesTab svc={svc} />}
    </div>
  );
}

async function MetricsTab() {
  const { configured, charts, targetsUp, error } = await safePlatformMetrics();
  if (!configured) return <NotConfigured source={SOURCE_LABEL.metrics} />;
  const hintByTitle = new Map(PLATFORM_CHARTS.map((c) => [c.title, c.hint]));
  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Could not reach VictoriaMetrics: {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-md border border-border px-3 py-1.5">
          Targets up:{' '}
          <span className="font-semibold tabular-nums text-foreground">
            {targetsUp ?? 'awaiting emission'}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          Charts labelled &ldquo;not emitting yet&rdquo; are live-connected but the metric has no
          data in the window — no fabricated values.
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-2">
        {charts.map((c) => (
          <MetricChart key={c.title} chart={c} hint={hintByTitle.get(c.title)} />
        ))}
      </div>
    </div>
  );
}

async function LogsTab({ query }: Readonly<{ query?: string }>) {
  const result = await safeSearchLogs(query ?? '', 200);
  if (!result.configured) return <NotConfigured source={SOURCE_LABEL.logs} />;
  return (
    <div className="space-y-4">
      <LogsSearchBox query={result.query} />
      {result.error && (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Could not reach VictoriaLogs: {result.error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {result.rows.length} line{result.rows.length === 1 ? '' : 's'} for{' '}
        <code>{result.query}</code>
        {result.rows.length === 0 && !result.error ? ' — no matching logs in the stream yet.' : '.'}
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
            {result.rows.map((r, i) => (
              <TableRow key={`${r.time}-${i}`}>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {r.time || '—'}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {r.stream || '—'}
                </TableCell>
                <TableCell className="font-mono text-xs text-foreground">
                  {r.message || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

async function TracesTab({ svc }: Readonly<{ svc?: string }>) {
  const { configured, services, traces, selectedService, webUrl, error } = await safeJaegerOverview(
    svc,
    20,
  );
  if (!configured) return <NotConfigured source={SOURCE_LABEL.traces} />;
  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Could not reach Jaeger: {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {services.length ? (
          <ServiceSelect services={services} selected={selectedService} />
        ) : (
          <span className="text-xs text-muted-foreground">
            No services reporting traces yet — awaiting OTLP spans.
          </span>
        )}
        {webUrl && (
          <a
            href={webUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary underline"
          >
            Open full waterfall in Jaeger UI ↗
          </a>
        )}
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
            {traces.map((t) => (
              <TableRow key={t.traceId}>
                <TableCell className="text-sm text-foreground">{t.rootOperation}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {t.service}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">{t.spanCount}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{t.durationMs} ms</TableCell>
                <TableCell className="font-mono text-xs">
                  {webUrl ? (
                    <a
                      href={`${webUrl.replace(/\/search$/, '')}/trace/${encodeURIComponent(t.traceId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      {t.traceId.slice(0, 12)}…
                    </a>
                  ) : (
                    `${t.traceId.slice(0, 12)}…`
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {traces.length === 0 && selectedService && !error && (
        <p className="text-xs text-muted-foreground">
          No recent traces for <code>{selectedService}</code> in the last hour.
        </p>
      )}
    </div>
  );
}
