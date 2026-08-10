import { ArrowsLeftRight, Database } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { currentEtlConnections } from '@/lib/etl-scope';
import { listEtlJobs } from '@/lib/etl-jobs-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const FLOW_TYPES = [
  {
    href: '/data/flows/replication',
    title: 'Replicated syncs',
    body: 'Move source data through managed connector syncs.',
  },
  {
    href: '/data/flows/orchestration',
    title: 'Orchestrated jobs',
    body: 'Run mapped, scheduled warehouse jobs and transformations.',
  },
] as const;

// The landing page for the two flow types. Each card is a way IN, but a bare menu with no read of
// its own looked dead next to children that hold real state (a live replication connection, real
// orchestration jobs) — so this reads the SAME data those children already own (currentEtlConnections,
// listEtlJobs) and surfaces it as a stat rail. No new I/O path, no duplicated decision — just the two
// existing counts, once, at the level a buyer lands on first.
export default async function DataFlowsPage() {
  const orgId = await currentOrgId();
  const [connections, jobs] = await Promise.all([currentEtlConnections(), listEtlJobs(orgId)]);
  const activeConnections = connections.filter((c) => c.status === 'active').length;
  const succeededJobs = jobs.filter((j) => j.lastRunStatus === 'succeeded').length;

  return (
    <div className="w-full space-y-6">
      <StatRail cols={2}>
        <FlowStat
          icon={<Database className="size-4" />}
          label="Replication connections"
          value={connections.length}
          sub={connections.length ? `${activeConnections} active` : 'none configured yet'}
        />
        <FlowStat
          icon={<ArrowsLeftRight className="size-4" />}
          label="Orchestrated jobs"
          value={jobs.length}
          sub={jobs.length ? `${succeededJobs} have run successfully` : 'none created yet'}
        />
      </StatRail>

      <div className="grid gap-4 lg:grid-cols-2">
        {FLOW_TYPES.map((flow) => (
          <Link key={flow.href} href={flow.href}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="text-base">{flow.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{flow.body}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function FlowStat({
  icon,
  label,
  value,
  sub,
}: Readonly<{ icon: ReactNode; label: string; value: number; sub: string }>) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[10px] uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-lg font-semibold text-foreground">{value}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/70">{sub}</div>
      </CardContent>
    </Card>
  );
}
