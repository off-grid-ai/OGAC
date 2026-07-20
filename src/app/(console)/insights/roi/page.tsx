import {
  Clock,
  CurrencyDollar,
  Lightning,
  TrendUp,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import { RoiOrgDefaults } from '@/components/insights/RoiOrgDefaults';
import { RoiTopApps } from '@/components/insights/RoiTopApps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireModuleForUser } from '@/lib/module-access';
import { formatHours, formatUsd, resolveRoiSettings } from '@/lib/roi';
import { computeOrgRoiRollup } from '@/lib/roi-reader';
import { getOrgRoiDefault } from '@/lib/roi-settings-store';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// ─── Insights › ROI — the value story per app + per department ────────────────────────────────────
// The renewal + budget-justification lever: hours + $ saved by department and the top apps by value,
// against the actual AI cost. Real run counts + real cost; ESTIMATED time-saved (labelled as such).
export default async function RoiPage() {
  await requireModuleForUser('analytics');
  const orgId = await currentOrgId();
  const [rollup, orgDefaultRaw] = await Promise.all([
    computeOrgRoiRollup(orgId),
    getOrgRoiDefault(orgId),
  ]);
  const orgDefault = resolveRoiSettings(null, orgDefaultRaw);
  const t = rollup.totals;

  const stats: {
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
    estimate: boolean;
  }[] = [
    {
      label: 'Runs completed',
      value: t.runsCompleted.toLocaleString('en-US'),
      icon: Lightning,
      estimate: false,
    },
    { label: 'Hours saved', value: formatHours(t.hoursSaved), icon: Clock, estimate: true },
    {
      label: 'Value of time saved',
      value: formatUsd(t.grossValue),
      icon: CurrencyDollar,
      estimate: true,
    },
    { label: 'AI cost', value: formatUsd(t.actualAiCost), icon: CurrencyDollar, estimate: false },
  ];

  return (
    <PageFrame>
      {
        <div className="w-full space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Return on investment</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                What your automations are worth — hours and $ saved per app and per department,
                against the actual AI cost. Run counts and AI cost are{' '}
                <span className="font-medium text-primary">measured</span>; time-saved is an{' '}
                <span className="font-medium text-amber-600">estimate</span> you set (org default
                below, per-app on each app&apos;s Reports tab).
              </p>
            </div>
          </div>

          <StatRail>
            {stats.map((s) => (
              <Card key={s.label} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </CardTitle>
                  <s.icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tabular-nums text-foreground">
                    {s.value}
                  </div>
                  <div className="mt-1">
                    <span
                      className={`rounded px-1 py-0.5 text-xs font-medium ${
                        s.estimate ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {s.estimate ? 'estimate' : 'actual'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </StatRail>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center gap-3">
              <TrendUp className="size-5 text-primary" />
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Net value this period (est.)
                </div>
                <div
                  className={`text-3xl font-semibold tabular-nums ${
                    t.netValue >= 0 ? 'text-primary' : 'text-destructive'
                  }`}
                >
                  {formatUsd(t.netValue)}
                </div>
              </div>
            </div>
            {t.roiMultiple !== null ? (
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Value per $ of AI cost
                </div>
                <div className="text-3xl font-semibold tabular-nums text-foreground">
                  {t.roiMultiple}×
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No AI cost recorded this period.</div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <UsersThree className="size-4 text-muted-foreground" />
                  By department
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Rolled up from each app&apos;s owning department. Richest first; unassigned apps
                  last.
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-right">Apps</TableHead>
                        <TableHead className="text-right">Hours saved</TableHead>
                        <TableHead className="text-right">Value (est.)</TableHead>
                        <TableHead className="text-right">AI cost</TableHead>
                        <TableHead className="text-right">Net (est.)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rollup.byDepartment.length ? (
                        rollup.byDepartment.map((d) => (
                          <TableRow key={d.department}>
                            <TableCell className="font-medium text-foreground">
                              {d.department}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {d.appCount}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatHours(d.hoursSaved)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-foreground">
                              {formatUsd(d.grossValue)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatUsd(d.actualAiCost)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium tabular-nums ${
                                d.netValue >= 0 ? 'text-primary' : 'text-destructive'
                              }`}
                            >
                              {formatUsd(d.netValue)}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="py-8 text-center text-sm text-muted-foreground"
                          >
                            No apps yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <RoiOrgDefaults initial={orgDefault} />
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Top apps by value</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Every app ranked by net value. Open one for its full ROI card and to tune its
                estimate.
              </p>
            </CardHeader>
            <CardContent>
              <RoiTopApps apps={rollup.topApps} />
            </CardContent>
          </Card>
        </div>
      }
    </PageFrame>
  );
}
