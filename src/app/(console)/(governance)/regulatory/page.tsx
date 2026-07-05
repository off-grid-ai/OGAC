import { DownloadSimple as Download } from '@phosphor-icons/react/dist/ssr';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { ProvenancePanel } from '@/components/provenance/ProvenancePanel';
import { ActivityRangeControls } from '@/components/regulatory/ActivityRangeControls';
import { AddGovernanceButton } from '@/components/regulatory/AddGovernanceButton';
import { EditGovernanceButton } from '@/components/regulatory/EditGovernanceButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { computeCompliance } from '@/lib/compliance';
import { buildComplianceActivity } from '@/lib/compliance-activity';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { listGovernance, readComplianceActivity } from '@/lib/store';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  satisfied: 'bg-primary/10 text-primary',
  partial: 'bg-amber-500/10 text-amber-600',
  gap: 'bg-destructive/10 text-destructive',
};

const GOV_STATUS: Record<string, string> = {
  active: 'bg-primary/10 text-primary',
  due: 'bg-amber-500/10 text-amber-600',
  expired: 'bg-destructive/10 text-destructive',
  draft: 'text-muted-foreground',
};

// A date-only string (YYYY-MM-DD) N days ago, for the default activity window.
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

export default async function RegulatoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireModuleForUser('regulatory');
  const org = await currentOrgId();
  const sp = await searchParams;
  const fromDate = sp.from ?? daysAgo(30);
  const toDate = sp.to ?? new Date().toISOString().slice(0, 10);
  // Turn the date-only inputs into an inclusive instant range for the ledger read.
  const q = { from: `${fromDate}T00:00:00.000Z`, to: `${toDate}T23:59:59.999Z`, org };

  const [c, governance, activityData] = await Promise.all([
    computeCompliance(),
    listGovernance(org),
    readComplianceActivity(q),
  ]);
  const activity = buildComplianceActivity(activityData.rows, activityData.coverage, q);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Overall posture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-foreground">{c.posture}%</div>
            <Progress value={c.posture} className="mt-3" />
          </CardContent>
        </Card>
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Full evidence pack</CardTitle>
            <Button asChild size="sm">
              <a href="/api/v1/admin/compliance/export">
                <Download className="size-4" />
                Download
              </a>
            </Button>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            A regulator-ready Markdown pack: posture, every framework&apos;s coverage, and each
            control&apos;s status + evidence — generated live from the control plane.
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {c.frameworks.map((f) => (
          <Card key={f.id} className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">{f.name}</CardTitle>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/v1/admin/compliance/export?framework=${f.id}`}>
                  <Download className="size-4" />
                  DPIA
                </a>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Progress value={f.coverage} className="flex-1" />
                <span className="text-sm font-medium text-foreground">{f.coverage}%</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {f.controlIds.map((id) => {
                  const ctrl = c.controls.find((x) => x.id === id);
                  return (
                    <Badge key={id} variant="secondary" className={ctrl ? STATUS[ctrl.status] : ''}>
                      {ctrl?.name ?? id}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-sm">DPO activity — data processing over a time range</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Aggregated live from the real audit ledger: who did what, what was blocked or denied,
              and what it cost — plus provenance signing coverage. Export the DPIA pack for the
              regulator.
            </p>
          </div>
          <ActivityRangeControls from={fromDate} to={toDate} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Stat label="Events" value={String(activity.totals.events)} />
            <Stat label="Actors" value={String(activity.totals.actors)} />
            <Stat
              label="Blocked / denied"
              value={String(activity.totals.blockedOrDenied)}
              tone={activity.totals.blockedOrDenied > 0 ? 'warn' : undefined}
            />
            <Stat label="Redacted" value={String(activity.totals.redacted)} />
            <Stat label="Cost" value={`$${activity.totals.costUsd.toFixed(2)}`} />
            <Stat
              label="Provenance"
              value={`${activity.provenance.coveragePct}%`}
              sub={`${activity.provenance.signed}/${activity.provenance.runs} runs signed`}
            />
          </div>

          {activity.byActor.length > 0 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Top actors</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Actor</TableHead>
                      <TableHead className="text-right">Events</TableHead>
                      <TableHead className="text-right">Blocked</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activity.byActor.slice(0, 8).map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium text-foreground">{r.key}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.events}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.blocked}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          ${r.costUsd.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">By action</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Events</TableHead>
                      <TableHead className="text-right">Blocked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activity.byAction.slice(0, 8).map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-mono text-xs text-foreground">{r.key}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.events}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.blocked}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              Enforcement — blocked &amp; denied actions
            </div>
            {activity.blockedEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No blocked or denied actions in this window.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activity.blockedEvents.slice(0, 25).map((e, i) => (
                    <TableRow key={`${e.runId}-${e.ts}-${i}`}>
                      <TableCell className="text-muted-foreground">
                        {e.ts ? e.ts.replace('T', ' ').slice(0, 19) : '—'}
                      </TableCell>
                      <TableCell className="text-foreground">{e.actor}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.action}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                          {e.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.runId || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Control</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.controls.map((ctrl) => (
                <TableRow key={ctrl.id}>
                  <TableCell className="font-medium text-foreground">{ctrl.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={STATUS[ctrl.status]}>
                      {ctrl.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{ctrl.evidence}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Governance registry</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              The org/regulatory wrapper — policies, committees, and processes tracked as attestable
              records (Phase E).
            </p>
          </div>
          <AddGovernanceButton />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewed</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {governance.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium text-foreground">{g.title}</TableCell>
                  <TableCell className="text-muted-foreground">{g.kind}</TableCell>
                  <TableCell className="text-muted-foreground">{g.owner || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={GOV_STATUS[g.status]}>
                      {g.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{g.reviewedAt || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <EditGovernanceButton
                        id={g.id}
                        title={g.title}
                        owner={g.owner}
                        status={g.status}
                        reviewedAt={g.reviewedAt}
                      />
                      <DeleteRowButton url={`/api/v1/admin/governance/${g.id}`} label={g.title} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProvenancePanel />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold ${tone === 'warn' ? 'text-amber-600' : 'text-foreground'}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
