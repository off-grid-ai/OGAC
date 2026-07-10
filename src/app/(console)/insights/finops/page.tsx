import { IssueKeyButton } from '@/components/finops/IssueKeyButton';
import { KeysTable } from '@/components/finops/KeysTable';
import { TokenBudgets } from '@/components/finops/TokenBudgets';
import { GatewayCost } from '@/components/gateway/GatewayCost';
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
import { computeFinOps } from '@/lib/finops';
import { requireModuleForUser } from '@/lib/module-access';
import { PipelineFacetSelect } from '@/components/pipelines/PipelineFacetSelect';
import { pipelineTag } from '@/lib/pipeline-api-key-format';
import { resolvePipelineFacet } from '@/lib/pipelines-policy';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const usd = (n: number) => `$${n.toFixed(2)}`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-3xl font-semibold text-foreground">{value}</CardContent>
    </Card>
  );
}

export default async function FinOpsPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  await requireModuleForUser('finops');
  const { pipeline: rawPipeline } = await searchParams;
  const orgId = await currentOrgId();
  const pipelines = await listPipelines(orgId).catch(() => []);
  const facet = resolvePipelineFacet(rawPipeline, pipelines.map((p) => p.id));
  const facetName = facet ? pipelines.find((p) => p.id === facet)?.name ?? facet : null;
  const f = await computeFinOps(facet ? pipelineTag(facet) : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">FinOps</h1>
          <p className="text-sm text-muted-foreground">
            Spend, usage, and budgets priced from real gateway traffic.
            {facetName ? (
              <span className="text-foreground"> Filtered to pipeline “{facetName}”.</span>
            ) : null}
          </p>
        </div>
        <PipelineFacetSelect pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} />
      </div>

      <StatRail>
        <Stat label="Spend (all time)" value={usd(f.totals.costUsd)} />
        <Stat label="Requests" value={f.totals.requests.toLocaleString()} />
        <Stat label="Tokens" value={f.totals.tokens.toLocaleString()} />
        <Stat label="Ran on-device" value={`${f.totals.localShare}%`} />
      </StatRail>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Virtual keys · {f.byKey.length}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Token issuance scoped to a user or project, metered against a budget.
            </p>
          </div>
          <IssueKeyButton />
        </CardHeader>
        <CardContent>
          <KeysTable rows={f.byKey} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Spend by model</CardTitle>
          </CardHeader>
          <CardContent>
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
                {f.byModel.map((m) => (
                  <TableRow key={m.label}>
                    <TableCell className="font-medium text-foreground">{m.label}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{m.requests}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {m.tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {usd(m.costUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Spend by person / project</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.bySubject.map((s) => (
                  <TableRow key={s.label}>
                    <TableCell className="font-medium text-foreground">{s.label}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{s.requests}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {usd(s.costUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <TokenBudgets />

      <GatewayCost />
    </div>
  );
}
