import { ArrowLeft, Cpu } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeviceActions } from '@/components/fleet/DeviceActions';
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
import { requireModule } from '@/lib/modules';
import { getDevice, listAudit, pullPolicyForDevice } from '@/lib/store';

export const dynamic = 'force-dynamic';

const OUTCOME: Record<string, string> = {
  ok: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  redacted: 'bg-amber-500/10 text-amber-600',
};

type Policy = Awaited<ReturnType<typeof pullPolicyForDevice>>;
type Audit = Awaited<ReturnType<typeof listAudit>>;

function PolicyCard({ policy }: { policy: Policy }) {
  const egress = Boolean(policy?.egressAllowed);
  const guardrails = policy?.guardrails ?? [];
  const models = policy?.allowedModels ?? [];
  const egressCls = egress ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary';
  const egressLabel = egress ? 'allowed' : 'blocked';
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Assigned policy</CardTitle>
        <p className="text-xs text-muted-foreground">
          The bundle this device pulls from the control plane.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Egress</span>
          <Badge variant="secondary" className={egressCls}>
            {egressLabel}
          </Badge>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Guardrails</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {guardrails.map((g) => (
              <Badge key={g} variant="outline">
                {g}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Allowed models
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {models.map((m) => (
              <Badge key={m} variant="secondary" className="bg-primary/10 text-primary">
                {m}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ audit }: { audit: Audit }) {
  return (
    <Card className="shadow-sm lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">Recent activity</CardTitle>
        <p className="text-xs text-muted-foreground">
          {audit.length} events from this device — model calls, egress, and guardrail outcomes.
        </p>
      </CardHeader>
      <CardContent>
        {audit.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Egress</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {e.ts.slice(0, 16).replace('T', ' ')}
                  </TableCell>
                  <TableCell className="text-foreground">{e.model}</TableCell>
                  <TableCell className="text-muted-foreground">{e.tokens}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.leftDevice ? 'left device' : 'on-device'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={OUTCOME[e.outcome] ?? ''}>
                      {e.outcome}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  requireModule('fleet');
  const { id } = await params;
  const device = await getDevice(id);
  if (!device) notFound();
  const [policy, audit] = await Promise.all([
    pullPolicyForDevice(id),
    listAudit({ deviceId: id, limit: 25 }),
  ]);
  const statusCls =
    device.status === 'online' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground';

  const facts = [
    { label: 'OS', value: device.os },
    { label: 'Role', value: device.role },
    { label: 'Policy', value: `v${device.policyVersion}` },
    { label: 'Last seen', value: device.lastSeen },
    { label: 'Enrolled', value: device.enrolledAt.slice(0, 10) },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/fleet"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Fleet
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Cpu className="size-6 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">{device.name}</h1>
              <Badge variant="secondary" className={statusCls}>
                {device.status}
              </Badge>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{device.id}</p>
          </div>
        </div>
        <DeviceActions deviceId={device.id} name={device.name} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {facts.map((f) => (
          <Card key={f.label} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                {f.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm font-medium text-foreground">{f.value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <PolicyCard policy={policy} />
        <ActivityCard audit={audit} />
      </div>
    </div>
  );
}
