import { DriftCatalog } from '@/components/drift/DriftCatalog';
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
import { getDrift } from '@/lib/adapters/registry';
import { readDriftView, type DriftDisplayStatus } from '@/lib/drift-view';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<DriftDisplayStatus, string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-muted text-foreground',
  drift: 'bg-destructive/10 text-destructive',
};

export default async function QualityDriftPage() {
  await requireModuleForUser('drift');
  const { data, error } = await readDriftView({ orgId: await currentOrgId() });
  const adapter = getDrift().meta;
  const engineStatus = {
    evidentlySelected: adapter.id === 'evidently',
    evidentlyConfigured: Boolean(adapter.embedUrl),
  };

  return (
    <div className="grid w-full gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Signal label="Verdict">
            <Badge variant="secondary" className={data ? STATUS_CLASS[data.status] : ''}>
              {data?.status ?? 'unavailable'}
            </Badge>
          </Signal>
          <Signal label="Engine">
            <span className="text-sm">{data?.engine ?? adapter.id}</span>
          </Signal>
          <Signal label="Baseline window">
            <span className="text-2xl">{data?.baseline ?? 0}</span>
          </Signal>
          <Signal label="Current window">
            <span className="text-2xl">{data?.current ?? 0}</span>
          </Signal>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Current drift evidence</CardTitle>
            <p className="text-xs text-muted-foreground">
              {data?.note ?? error ?? 'No drift evidence was returned.'}
            </p>
          </CardHeader>
          <CardContent>
            {!data || data.features.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                At least four recorded evaluation runs are required before the built-in comparison
                can form baseline and current windows.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric or feature</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.features.map((feature) => (
                      <TableRow key={feature.name}>
                        <TableCell className="font-medium">{feature.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {feature.score ?? 'not reported'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={STATUS_CLASS[feature.status]}>
                            {feature.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Engine availability</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {engineStatus.evidentlySelected && engineStatus.evidentlyConfigured
              ? 'Evidently is selected and configured. Catalog selections run through the collector.'
              : 'Evidently is not the verified active path. Checks run with the built-in eval-score PSI and mean-degradation fallback, and results remain attributed to that engine.'}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Run a drift check</CardTitle>
          <p className="text-xs text-muted-foreground">
            Choose a supported preset or method. The result states which engine actually ran.
          </p>
        </CardHeader>
        <CardContent>
          <DriftCatalog engineStatus={engineStatus} />
        </CardContent>
      </Card>
    </div>
  );
}

function Signal({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
