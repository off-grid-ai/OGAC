import { DownloadSimple as Download } from '@phosphor-icons/react/dist/ssr';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { ProvenancePanel } from '@/components/provenance/ProvenancePanel';
import { AddGovernanceButton } from '@/components/regulatory/AddGovernanceButton';
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
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { listGovernance } from '@/lib/store';

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

export default async function RegulatoryPage() {
  await requireModuleForUser('regulatory');
  const org = await currentOrgId();
  const [c, governance] = await Promise.all([computeCompliance(), listGovernance(org)]);

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
                    <DeleteRowButton url={`/api/v1/admin/governance/${g.id}`} label={g.title} />
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
