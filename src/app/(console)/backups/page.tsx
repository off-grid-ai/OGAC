import { Archive, CloudArrowUp, Clock, Database, Warning } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { readBackupsView } from '@/lib/backups';
import { formatAge, formatBytes } from '@/lib/backups-view';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function BackupsPage() {
  await requireModuleForUser('backups');
  const { view, error } = await readBackupsView();
  const { config, latest } = view;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Archive className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Backups &amp; DR</h1>
          <p className="text-sm text-muted-foreground">
            Read-only status of the on-prem backup job — latest dump, retention window, and off-box
            replication. Backups run nightly on S1 ({config.backupRoot}).
          </p>
        </div>
      </div>

      {error ? (
        <Card className="shadow-sm">
          <CardContent className="py-8 text-center text-xs text-destructive">
            Backup directory unreadable: {error}
          </CardContent>
        </Card>
      ) : null}

      {view.stale ? (
        <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
          <CardContent className="flex items-center gap-3 py-4">
            <Warning className="size-5 shrink-0 text-destructive" />
            <div className="text-sm text-foreground">
              <span className="font-semibold text-destructive">Backup overdue.</span>{' '}
              {latest
                ? `Most recent backup is ${formatAge(view.latestAgeMs)} — older than the ${config.staleAfterHours}h threshold.`
                : `No backups found in ${config.backupRoot}.`}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          icon={<Clock className="size-4" />}
          label="Latest backup"
          value={latest ? formatAge(view.latestAgeMs) : '—'}
          sub={latest?.name ?? 'none'}
        />
        <SummaryTile
          icon={<Database className="size-4" />}
          label="Total size"
          value={formatBytes(view.totalSizeBytes)}
          sub={`${view.count} dump${view.count === 1 ? '' : 's'}`}
        />
        <SummaryTile
          icon={<Archive className="size-4" />}
          label="Within retention"
          value={`${view.countWithinRetention}`}
          sub={`${config.retentionDays}-day window`}
        />
        <SummaryTile
          icon={<CloudArrowUp className="size-4" />}
          label="Off-box replication"
          value={view.offBoxEnabled ? 'Enabled' : 'Disabled'}
          sub={view.offBoxEnabled ? (config.offBoxTarget ?? '') : 'no peer configured'}
        />
      </div>

      {/* Backups table — newest first */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Backups</CardTitle>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {view.count} total
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {view.rows.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              No backups found. The nightly job writes timestamped dumps to {config.backupRoot}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-medium">Backup</th>
                    <th className="py-2 pr-4 font-medium">Age</th>
                    <th className="py-2 pr-4 font-medium">Size</th>
                    <th className="py-2 pr-4 font-medium">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.name} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-4 font-mono text-foreground">{r.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{formatAge(r.ageMs)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{formatBytes(r.sizeBytes)}</td>
                      <td className="py-2 pr-4">
                        {r.withinRetention ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary">
                            kept
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            aged out
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[10px] uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-lg font-semibold text-foreground">{value}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/70" title={sub}>
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}
