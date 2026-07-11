import { notFound } from 'next/navigation';
import { LensLink } from '@/components/pipelines/telemetry/LensLink';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { computeAccounting } from '@/lib/accounting';
import { pipelineCostSlice, pipelineTag } from '@/lib/pipeline-api-key-format';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const usd = (n: number) => `$${n.toFixed(2)}`;

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </CardContent>
    </Card>
  );
}

// The Cost tab — spend attributed to THIS pipeline → its gateway/model. A lens over the org-wide
// accounting fact table (computeAccounting), narrowed by the pure pipelineCostSlice to the row this
// pipeline's runs are stamped under (project/caller = "pipeline:<id>"). Honest: an empty slice means
// nothing is billed to this pipeline yet — never fabricated.
export default async function PipelineCostPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();

  const accounting = await computeAccounting('all');
  const slice = pipelineCostSlice(id, accounting);

  return (
    <div className="w-full space-y-4">
      <LensLink pipelineName={p.name} surface="FinOps" href="/insights/finops" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Spend" value={usd(slice.costUsd)} />
        <Stat label="Requests" value={slice.requests.toLocaleString()} />
        <Stat label="Tokens" value={slice.tokens.toLocaleString()} />
        <Stat label="Gateway" value={p.gateway?.name ?? '—'} />
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Spend by model</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cost attributed to runs tagged <code className="text-xs">{pipelineTag(id)}</code>, rolled
            up to the model that served them.
          </p>
        </CardHeader>
        <CardContent>
          {!slice.attributed || slice.byModel.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No spend attributed to this pipeline yet. Runs invoked through this pipeline&apos;s
              provisioned key or bound apps will appear here, keyed to it.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slice.byModel.map((m) => (
                    <TableRow key={m.model}>
                      <TableCell className="font-medium">{m.model}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.requests.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{usd(m.costUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
