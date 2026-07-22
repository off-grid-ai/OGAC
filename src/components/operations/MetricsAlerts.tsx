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
import type { AlertView, AlertsSummary, RuleView } from '@/lib/victoriametrics-query';

// Alerts view — presentational. Recording + alerting RULES and firing ALERTS from VM's rule engine.
// When no engine is deployed (plain VM has no vmalert) it renders an explicit honest empty state.
export function MetricsAlerts({
  configured,
  engineDeployed,
  engineError,
  recording = [],
  alerting = [],
  alerts = [],
  summary = { firing: 0, pending: 0, total: 0 },
}: Readonly<{
  configured: boolean;
  engineDeployed: boolean;
  engineError?: string;
  recording?: RuleView[];
  alerting?: RuleView[];
  alerts?: AlertView[];
  summary?: AlertsSummary;
}>) {
  if (!configured) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
        VictoriaMetrics isn&apos;t connected yet. Connect it in Configuration to read alerts here.
      </p>
    );
  }
  if (!engineDeployed) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-10 text-center">
        <span className="text-sm font-medium text-foreground">No alerting engine deployed</span>
        <span className="max-w-lg text-xs text-muted-foreground">
          VictoriaMetrics is connected, but no rule engine (vmalert) is running against it — so there
          are no recording/alerting rules or firing alerts to show. Deploy vmalert and point it at
          this instance to manage alert rules here.
        </span>
        {engineError ? (
          <span className="font-mono text-[11px] text-muted-foreground/60">{engineError}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Summary band */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Firing" value={summary.firing} tone="firing" />
        <SummaryTile label="Pending" value={summary.pending} tone="pending" />
        <SummaryTile label="Alert rules" value={alerting.length} tone="neutral" />
      </div>

      {/* Firing/pending alerts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Active alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No active alerts.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Alert</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Labels</TableHead>
                    <TableHead>Since</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((a, i) => (
                    <TableRow key={`${a.name}-${i}`}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>
                        <Badge variant={a.state === 'firing' ? 'destructive' : 'secondary'}>
                          {a.state || 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {labelPreview(a.labels)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.activeAt || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rules — two columns on lg+ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RulesCard title="Alerting rules" rules={alerting} showState />
        <RulesCard title="Recording rules" rules={recording} />
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: Readonly<{ label: string; value: number; tone: 'firing' | 'pending' | 'neutral' }>) {
  const color =
    tone === 'firing'
      ? 'text-destructive'
      : tone === 'pending'
        ? 'text-amber-500'
        : 'text-foreground';
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function RulesCard({
  title,
  rules,
  showState = false,
}: Readonly<{ title: string; rules: RuleView[]; showState?: boolean }>) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {title} <span className="text-muted-foreground">({rules.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r, i) => (
              <li key={`${r.name}-${i}`} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                  {showState ? (
                    <Badge variant={r.state === 'firing' ? 'destructive' : 'secondary'}>
                      {r.state || 'inactive'}
                    </Badge>
                  ) : (
                    <Badge variant={r.health === 'ok' ? 'secondary' : 'destructive'}>
                      {r.health}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {r.query}
                </p>
                {r.group ? (
                  <span className="text-[10px] text-muted-foreground/70">group: {r.group}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function labelPreview(labels: Record<string, string>): string {
  const entries = Object.entries(labels).filter(([k]) => k !== 'alertname');
  if (entries.length === 0) return '—';
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}
