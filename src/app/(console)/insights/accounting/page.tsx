import Link from 'next/link';
import { Coins, CurrencyDollar, Users, FolderSimple } from '@phosphor-icons/react/dist/ssr';
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
import { computeAccounting } from '@/lib/accounting';
import { isRangePreset, type RangePreset } from '@/lib/accounting-aggs';
import { requireModuleForUser } from '@/lib/module-access';
import { PipelineFacetSelect } from '@/components/pipelines/PipelineFacetSelect';
import { pipelineTag } from '@/lib/pipeline-api-key-format';
import { resolvePipelineFacet } from '@/lib/pipelines-policy';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const usd = (n: number) => `$${n.toFixed(2)}`;
const num = (n: number) => n.toLocaleString();

const RANGES: { key: RangePreset; label: string }[] = [
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
];

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="text-2xl font-semibold text-foreground">{value}</CardContent>
    </Card>
  );
}

// Usage & spend accounting — attributed token usage + spend per user, per project, and per model
// over a time range. The range is URL-driven (?range=7d), a server round-trip — linkable, history
// -aware, no client state (nav mandate). A thin view over the native OpenSearch aggregation in
// computeAccounting(); ADDITIVE to Analytics/FinOps, which are untouched.
export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; pipeline?: string }>;
}) {
  await requireModuleForUser('accounting');
  const { range: rawRange, pipeline: rawPipeline } = await searchParams;
  const range: RangePreset = rawRange && isRangePreset(rawRange) ? rawRange : 'all';
  const orgId = await currentOrgId();
  const pipelines = await listPipelines(orgId).catch(() => []);
  const facet = resolvePipelineFacet(rawPipeline, pipelines.map((p) => p.id));
  const a = await computeAccounting(range, facet ? pipelineTag(facet) : null);
  const facetName = facet ? pipelines.find((p) => p.id === facet)?.name ?? facet : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Usage &amp; Spend</h1>
          <p className="text-sm text-muted-foreground">
            Token usage and spend attributed per user, per project, and per model — over the selected
            window. Read from real gateway traffic on-prem.
            {facetName ? (
              <span className="text-foreground"> Filtered to pipeline “{facetName}”.</span>
            ) : null}
          </p>
        </div>
        {/* Pipeline facet + time-range selector — both URL-driven (server round-trip, deep-linkable). */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <PipelineFacetSelect pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} />
          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={`/insights/accounting?range=${r.key}${facet ? `&pipeline=${facet}` : ''}`}
                className={`rounded-md border px-2 py-1 ${range === r.key ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Org totals */}
      <StatRail>
        <Stat label="Total spend" value={usd(a.totals.costUsd)} icon={CurrencyDollar} />
        <Stat label="Total tokens" value={num(a.totals.tokens)} icon={Coins} />
        <Stat label="Users" value={num(a.byActor.length)} icon={Users} />
        <Stat label="Projects" value={num(a.byProject.length)} icon={FolderSimple} />
      </StatRail>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top users by tokens + spend */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Top users · spend &amp; tokens</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Who spent what over the window, ranked by cost.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.byActor.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No usage in this window.
                    </TableCell>
                  </TableRow>
                ) : (
                  a.byActor.map((u) => (
                    <TableRow key={u.label}>
                      <TableCell className="max-w-[16rem] truncate font-medium text-foreground">
                        {u.label}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {num(u.requests)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {num(u.tokens)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {usd(u.costUsd)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Top projects by tokens + spend */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Top projects · spend &amp; tokens</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Token usage and spend for each project over the window.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.byProject.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No usage in this window.
                    </TableCell>
                  </TableRow>
                ) : (
                  a.byProject.map((p) => (
                    <TableRow key={p.label}>
                      <TableCell className="max-w-[16rem] truncate font-medium text-foreground">
                        {p.label}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {num(p.requests)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {num(p.tokens)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {usd(p.costUsd)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Per-model split (org-wide) */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Spend by model</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Org-wide token usage and spend per model — local models are $0.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Prompt</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.byModel.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No usage in this window.
                  </TableCell>
                </TableRow>
              ) : (
                a.byModel.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className="font-medium text-foreground">{m.model}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(m.requests)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(m.promptTokens)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(m.completionTokens)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {num(m.tokens)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {usd(m.costUsd)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
