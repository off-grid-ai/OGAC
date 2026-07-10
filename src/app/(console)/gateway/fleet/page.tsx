import {
  Circle as CircleDot,
  Cpu,
  ClockCounterClockwise as FileClock,
  ShieldCheck,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { DeviceActions } from '@/components/fleet/DeviceActions';
import { EnrollDeviceButton } from '@/components/fleet/EnrollDeviceButton';
import { FleetTools } from '@/components/fleet/FleetTools';
import { Badge } from '@/components/ui/badge';
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
import { getMdm } from '@/lib/adapters/registry';
import { requireModuleForUser } from '@/lib/module-access';
import { getOrgPolicy, listAudit, listDevices } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

interface Stat {
  label: string;
  value: string | number;
  icon: typeof Cpu;
}

export default async function FleetPage() {
  await requireModuleForUser('fleet');
  const org = await currentOrgId();
  const [devices, policy, audit] = await Promise.all([
    listDevices(org),
    getOrgPolicy(),
    listAudit({ limit: 500, orgId: org }),
  ]);
  const online = devices.filter((d) => d.status === 'online').length;
  const mdmPort = getMdm();
  const mdm = mdmPort.meta;
  // Host options for the live-query targeter — from the active MDM (FleetDM host ids when swapped
  // in, first-party ids otherwise). Only FleetDM's numeric ids can be targeted by osquery.
  const fleetSupported = mdmPort.supportsFleet === true;
  const hostOptions = fleetSupported
    ? (await mdmPort.listDevices(org)).map((d) => ({ id: d.id, name: d.name }))
    : [];

  const stats: Stat[] = [
    { label: 'Devices', value: devices.length, icon: Cpu },
    { label: 'Online', value: `${online}/${devices.length}`, icon: CircleDot },
    { label: 'Policy version', value: `v${policy.version}`, icon: ShieldCheck },
    { label: 'Audit events', value: audit.length, icon: FileClock },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          MDM backend
        </span>
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          {mdm.vendor}
        </Badge>
        <span className="text-xs text-muted-foreground">
          swap with OFFGRID_ADAPTER_MDM (native registry · FleetDM/osquery)
        </span>
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
              <div className="text-2xl font-semibold text-foreground">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </StatRail>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Devices</CardTitle>
          <EnrollDeviceButton />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Policy</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium text-foreground">
                    <Link href={`/gateway/fleet/${d.id}`} className="hover:text-primary">
                      {d.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.os}</TableCell>
                  <TableCell className="text-muted-foreground">{d.role}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        d.status === 'online'
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground'
                      }
                    >
                      <CircleDot className="size-3" />
                      {d.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.lastSeen}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    v{d.policyVersion}
                  </TableCell>
                  <TableCell>
                    <DeviceActions deviceId={d.id} name={d.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FleetTools hosts={hostOptions} supported={fleetSupported} />
    </div>
  );
}
